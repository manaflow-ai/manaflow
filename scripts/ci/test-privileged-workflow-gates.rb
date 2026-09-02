#!/usr/bin/env ruby

require "yaml"

WORKFLOWS = %w[
  .github/workflows/docker.yml
  .github/workflows/sandbox.yml
  .github/workflows/morph-snapshot.yml
  .github/workflows/host-screenshot-collector.yml
  .github/workflows/release-pr.yml
  .github/workflows/release-updates.yml
].freeze

PINNED_ACTION = %r{@[0-9a-f]{40}(?:\s+#.*)?\z}i
PRIVILEGED_TEXT = /(secrets\.|contents:\s*write|packages:\s*write|pull-requests:\s*write|actions:\s*write|git push|gh release|gh pr)/

errors = []

def stringify(value)
  case value
  when Hash
    value.map { |key, child| "#{key}:#{stringify(child)}" }.join(" ")
  when Array
    value.map { |child| stringify(child) }.join(" ")
  else
    value.to_s
  end
end

WORKFLOWS.each do |path|
  data = YAML.safe_load(File.read(path), aliases: false)
  events = data.fetch(true, data.fetch("on", {}))
  if events.key?("workflow_dispatch")
    errors << "#{path} exposes a manual workflow_dispatch trigger"
  end
  if path == ".github/workflows/release-updates.yml" && events.key?("push")
    errors << "release-updates.yml exposes a post-merge push trigger"
  end
  jobs = data.fetch("jobs")
  jobs.each do |job_id, job|
    job_text = stringify(job)
    privileged = job_text.match?(PRIVILEGED_TEXT)
    condition = job.fetch("if", "").to_s
    if privileged
      unless condition.include?("github.ref_protected == true")
        errors << "#{path} job #{job_id} lacks a protected-ref condition"
      end
      unless condition.include?("github.ref == 'refs/heads/main'") ||
             condition.include?("github.workflow_ref == 'manaflow-ai/manaflow/.github/workflows/release-pr.yml@refs/heads/main'")
        errors << "#{path} job #{job_id} lacks a protected main or trusted release caller condition"
      end
      if job_text.match?(/actions:\s*write/) || job_text.match?(/secrets:\s*inherit/)
        errors << "#{path} job #{job_id} requests an unsafe workflow permission or secret inheritance"
      end

      # A reusable-workflow caller has no steps of its own. The called
      # workflow owns checkout, trust verification, and secret use.
      if job.key?("uses")
        unless job["uses"] == "./.github/workflows/release-updates.yml"
          errors << "#{path} job #{job_id} calls an unexpected workflow: #{job["uses"]}"
        end
        next
      end

      steps = job.fetch("steps", [])
      checkout_index = steps.index do |step|
        step.is_a?(Hash) && step.fetch("uses", "").to_s.start_with?("actions/checkout@")
      end
      if checkout_index.nil?
        errors << "#{path} job #{job_id} has privileged operations but no checkout"
        next
      end

      checkout = steps.fetch(checkout_index)
      checkout_with = checkout.fetch("with", {})
      unless checkout_with["persist-credentials"] == false
        errors << "#{path} job #{job_id} checkout must set persist-credentials: false"
      end

      gate_index = steps.index do |step|
        next false unless step.is_a?(Hash)

        gate_run = step.fetch("run", "").to_s
        if path == ".github/workflows/release-updates.yml"
          gate_run.include?('git show "$TRUSTED_WORKFLOW_SHA:.github/scripts/verify-privileged-ref.sh"')
        else
          gate_run.strip == ".github/scripts/verify-privileged-ref.sh"
        end
      end
      if gate_index.nil? || gate_index != checkout_index + 1
        errors << "#{path} job #{job_id} must run the trust gate immediately after checkout"
      else
        gate_env = steps.fetch(gate_index).fetch("env", {})
        %w[TRUSTED_BASE_SHA TRUSTED_SOURCE_SHA TRUSTED_REF_KIND TRUSTED_WORKFLOW_PATH TRUSTED_WORKFLOW_SHA].each do |key|
          errors << "#{path} job #{job_id} gate lacks #{key}" unless gate_env.key?(key)
        end
        if path == ".github/workflows/release-updates.yml"
          %w[
            TRUSTED_CALLED_WORKFLOW_PATH
            TRUSTED_CALLER_REF
            TRUSTED_EVENT_REF
            TRUSTED_EVENT_REF_TYPE
            TRUSTED_EVENT_SHA
            TRUSTED_REF_PROTECTED
          ].each do |key|
            errors << "#{path} job #{job_id} gate lacks #{key}" unless gate_env.key?(key)
          end
          gate_run = steps.fetch(gate_index).fetch("run").to_s
          unless gate_run.include?('"$TRUSTED_WORKFLOW_SHA" == "$GITHUB_SHA"') &&
                 gate_run.include?('chmod 700 "$trusted_gate"')
            errors << "#{path} job #{job_id} must bootstrap the gate from the protected caller SHA"
          end
        end
        gate_shell = steps.fetch(gate_index).fetch("shell", "").to_s
        errors << "#{path} job #{job_id} gate must use bash" unless gate_shell == "bash"
        steps[0...gate_index].each_with_index do |step, index|
          if stringify(step).match?(%r{secrets\.})
            errors << "#{path} job #{job_id} exposes a secret before the trust gate (step #{index})"
          end
        end
      end
    end

    # Every checkout in these workflows is pinned and must not leave a token
    # in the local repository configuration.
    Array(job.fetch("steps", [])).each_with_index do |step, index|
      next unless step.is_a?(Hash)

      uses = step.fetch("uses", "").to_s
      if uses.start_with?("actions/") || uses.include?("/")
        unless uses.match?(PINNED_ACTION)
          errors << "#{path} job #{job_id} step #{index} uses an unpinned action: #{uses}"
        end
      end
    end
  end

  top_permissions = data.fetch("permissions", {})
  if top_permissions.is_a?(Hash) && top_permissions.values.any? { |value| value.to_s == "write" }
    errors << "#{path} grants write permission at workflow scope"
  end
end

release_updates = YAML.safe_load(File.read(".github/workflows/release-updates.yml"), aliases: false)
workflow_call = release_updates.fetch(true).fetch("workflow_call")
inputs = workflow_call.fetch("inputs")
%w[release_ref release_sha release_base_sha caller_sha].each do |key|
  errors << "release-updates.yml lacks workflow_call input #{key}" unless inputs.key?(key)
end

release_pr = YAML.safe_load(File.read(".github/workflows/release-pr.yml"), aliases: false)
build_release = release_pr.fetch("jobs").fetch("build-release")
trigger_text = stringify(build_release)
%w[release_ref release_sha release_base_sha caller_sha].each do |key|
  errors << "release-pr.yml does not forward #{key}" unless trigger_text.include?(key)
end
unless trigger_text.include?("release_pr_state == 'existing'") &&
       trigger_text.include?("release_pr_draft == 'true'")
  errors << "release-pr.yml must permit retries only for existing draft releases"
end
if build_release["secrets"] == "inherit" || trigger_text.match?(/secrets:\s*inherit/)
  errors << "release-pr.yml must not inherit caller secrets"
end
capture_step = release_pr.fetch("jobs").fetch("open-release-pr").fetch("steps").find { |step| step["id"] == "release_revision" }
capture_text = stringify(capture_step || {})
unless capture_text.include?("git show-ref --verify --quiet")
  errors << "release-pr.yml must assert the generated release branch exists locally"
end
change_step = release_pr.fetch("jobs").fetch("open-release-pr").fetch("steps").find { |step| step["id"] == "release_changes" }
change_text = stringify(change_step || {})
unless change_text.include?("git tag --list") && change_text.include?("--sort=-version:refname")
  errors << "release-pr.yml must find the latest version tag without ancestry-only lookup"
end
unless stringify(release_pr.fetch("jobs").fetch("open-release-pr")).include?("git fetch --force --tags origin")
  errors << "release-pr.yml must fetch version tags before change detection"
end
open_release_text = stringify(release_pr.fetch("jobs").fetch("open-release-pr"))
release_checkout = release_pr.fetch("jobs").fetch("open-release-pr").fetch("steps").find do |step|
  step.is_a?(Hash) && step.fetch("uses", "").to_s.start_with?("actions/checkout@")
end
unless release_checkout&.fetch("with", {})&.fetch("ref", nil) == "${{ github.sha }}"
  errors << "release-pr.yml must checkout the immutable scheduled SHA"
end
unless open_release_text.include?("gh api --method POST") &&
       open_release_text.include?("refs/tags/$release_tag") &&
       open_release_text.include?("RELEASE_PR_STATE\" != \"created\"")
  errors << "release-pr.yml must bind a new immutable tag and fail closed for missing retry tags"
end
unless open_release_text.include?("git merge-base --is-ancestor \"$EXPECTED_SHA\" \"$main_sha\"")
  errors << "release-pr.yml must allow delayed runs only on protected-main ancestry"
end
release_script = File.read("scripts/release-pr.ts")
unless release_script.include?("verifyGeneratedReleaseCommit")
  errors << "scripts/release-pr.ts must validate the generated commit before pushing"
end
unless release_script.include?("writeGithubOutput(\"release_pr_draft\", String(existing.draft))")
  errors << "scripts/release-pr.ts must expose existing draft state"
end
unless release_script.include?("refs/heads/${branchName}:refs/heads/${branchName}")
  errors << "scripts/release-pr.ts must fetch an existing release branch before retry"
end

%w[mac-arm64 mac-universal windows-x64 linux-x64].each do |job_id|
  environment = release_updates.fetch("jobs").fetch(job_id).fetch("environment", nil)
  unless environment == "electron"
    errors << "release-updates.yml job #{job_id} must resolve secrets through the electron environment"
  end
end
unless stringify(release_updates.fetch("jobs").fetch("prepare-release")).include?("inputs.caller_sha == github.sha")
  errors << "release-updates.yml does not bind caller_sha to github.sha"
end
prepare_release_text = stringify(release_updates.fetch("jobs").fetch("prepare-release"))
if prepare_release_text.include?("inputs.release_base_sha == inputs.caller_sha")
  errors << "release-updates.yml must allow a validated release base ancestor"
end
unless prepare_release_text.include?("--verify-tag")
  errors << "release-updates.yml must only create releases from an existing immutable tag"
end
unless prepare_release_text.include?("Release tag $resolved_tag does not point at $SOURCE_SHA") &&
       prepare_release_text.include?("Refusing to publish without a tag bound before this workflow call")
  errors << "release-updates.yml does not reject an existing tag at another source SHA"
end

gate_script = File.read(".github/scripts/verify-privileged-ref.sh")
unless gate_script.include?("git merge-base --is-ancestor \"$event_sha\" \"$remote_ref_sha\"")
  errors << "verify-privileged-ref.sh must accept only protected-main ancestry for delayed jobs"
end
unless gate_script.include?("release branch is not bound to its immutable release tag")
  errors << "verify-privileged-ref.sh must bind release branches to immutable tags"
end
unless gate_script.include?("tag workflow is not the current protected workflow revision") &&
       gate_script.include?("[[ \"$workflow_sha\" == \"$main_sha\" ]]")
  errors << "verify-privileged-ref.sh must bind credentialed tag workflows to current protected main"
end

if errors.empty?
  puts "privileged workflow gate static tests passed (release secrets stay environment-scoped)"
  exit 0
end

warn errors.join("\n")
exit 1
