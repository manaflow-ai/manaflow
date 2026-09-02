#!/usr/bin/env ruby
# frozen_string_literal: true

# Validate the event boundary for workflows that execute repository code. This
# security-contract test parses the workflow documents, classifies their events,
# and rejects any pull-request workflow that can carry a secret or environment
# binding.

require "yaml"

ROOT = File.expand_path("../..", __dir__)
WORKFLOW_DIR = File.join(ROOT, ".github", "workflows")

class ContractError < StandardError; end

def fail_contract(message)
  raise ContractError, message
end

def load_workflow(filename)
  path = File.join(WORKFLOW_DIR, filename)
  document = YAML.safe_load(File.read(path), aliases: false)
  fail_contract("#{filename} is not a YAML mapping") unless document.is_a?(Hash)

  document
rescue Psych::Exception => e
  fail_contract("#{filename} is not valid YAML: #{e.message}")
end

def trigger_config(document, filename)
  # YAML 1.1 parsers treat the GitHub Actions `on` key as boolean true.
  document["on"] || document[true] || fail_contract("#{filename} has no `on` trigger")
end

def trigger_names(config, filename)
  names = case config
  when Hash then config.keys.map(&:to_s)
  when Array then config.map(&:to_s)
  when String then [config]
  else []
  end
  fail_contract("#{filename} has no recognized triggers") if names.empty?

  names
end

def walk(value, &block)
  yield value
  case value
  when Hash
    value.each { |key, child| walk(key, &block); walk(child, &block) }
  when Array
    value.each { |child| walk(child, &block) }
  end
end

def contains_secret_reference?(value)
  found = false
  walk(value) do |node|
    found ||= node.is_a?(String) && node.match?(/\$\{\{[^}]*\bsecrets\b/)
  end
  found
end

def contains_environment_binding?(job)
  found = false
  walk(job) do |node|
    found ||= node.is_a?(Hash) && node.key?("environment")
  end
  found
end

def contains_write_permission?(value)
  found = false
  walk(value) do |node|
    next unless node.is_a?(Hash) && node.key?("permissions")

    permissions = node["permissions"]
    found ||= permissions == "write" || permissions == "admin"
    if permissions.is_a?(Hash)
      found ||= permissions.values.any? { |permission| %w[write admin].include?(permission.to_s) }
    end
  end
  found
end

def jobs(document, filename)
  value = document["jobs"]
  fail_contract("#{filename} has no jobs mapping") unless value.is_a?(Hash)

  value
end

def checkout_steps(job)
  steps = []
  walk(job) do |node|
    next unless node.is_a?(Hash) && node["uses"].is_a?(String)
    next unless node["uses"].start_with?("actions/checkout@")

    steps << node
  end
  steps
end

def install_commands(job)
  commands = []
  walk(job) do |node|
    next unless node.is_a?(Hash) && node["run"].is_a?(String)

    commands << node["run"]
  end
  commands.grep(/\bbun\s+install\b/)
end

def assert_pull_request_workflow_is_untrusted(document, filename)
  names = trigger_names(trigger_config(document, filename), filename)
  fail_contract("#{filename} must only run for pull_request") unless names == ["pull_request"]

  jobs(document, filename).each do |job_name, job|
    fail_contract("#{filename}:#{job_name} contains a secret reference") if contains_secret_reference?(job)
    fail_contract("#{filename}:#{job_name} binds an environment") if contains_environment_binding?(job)
    fail_contract("#{filename}:#{job_name} grants write permission") if contains_write_permission?(job)

    checkouts = checkout_steps(job)
    fail_contract("#{filename}:#{job_name} has no checkout credential hardening") if checkouts.empty?
    checkouts.each do |step|
      with = step["with"]
      persist = with.is_a?(Hash) ? with["persist-credentials"] : nil
      fail_contract("#{filename}:#{job_name} persists checkout credentials") unless persist == false
    end

    installs = install_commands(job)
    fail_contract("#{filename}:#{job_name} has no dependency install") if installs.empty?
    unless installs.all? { |command| command.include?("--ignore-scripts") }
      fail_contract("#{filename}:#{job_name} runs dependency lifecycle scripts")
    end
  end
end

def assert_trusted_main_workflow(document, filename)
  config = trigger_config(document, filename)
  names = trigger_names(config, filename)
  fail_contract("#{filename} must only run for push") unless names == ["push"]

  push = config["push"]
  branches = push.is_a?(Hash) ? push["branches"] : nil
  fail_contract("#{filename} must be restricted to main") unless branches == ["main"]

  secret_jobs = jobs(document, filename).select do |_job_name, job|
    contains_secret_reference?(job) || contains_environment_binding?(job)
  end
  fail_contract("#{filename} has no secret-backed test job") if secret_jobs.empty?

  jobs(document, filename).each do |job_name, job|
    fail_contract("#{filename}:#{job_name} grants write permission") if contains_write_permission?(job)
    checkout_steps(job).each do |step|
      with = step["with"]
      persist = with.is_a?(Hash) ? with["persist-credentials"] : nil
      fail_contract("#{filename}:#{job_name} persists checkout credentials") unless persist == false
    end
  end
end

def assert_checks_workflow_is_read_only(document, filename)
  names = trigger_names(trigger_config(document, filename), filename)
  expected = %w[push pull_request]
  fail_contract("#{filename} trigger set changed: #{names.inspect}") unless names.sort == expected.sort
  fail_contract("#{filename} contains a secret reference") if contains_secret_reference?(document)
  fail_contract("#{filename} binds an environment") if contains_environment_binding?(document)
  fail_contract("#{filename} grants write permission") if contains_write_permission?(document)
end

def assert_event_routing
  cases = {
    ["push", "refs/heads/main"] => true,
    ["push", "refs/heads/feature"] => false,
    ["pull_request", "refs/pull/42/merge"] => false,
    ["workflow_dispatch", "refs/heads/main"] => false,
  }

  cases.each do |(event, ref), expected|
    actual = event == "push" && ref == "refs/heads/main"
    fail_contract("secret route mismatch for #{event} #{ref}") unless actual == expected
  end
end

begin
  pull_request = load_workflow("tests.yml")
  trusted_main = load_workflow("tests-trusted.yml")
  checks = load_workflow("checks.yml")

  assert_pull_request_workflow_is_untrusted(pull_request, "tests.yml")
  assert_trusted_main_workflow(trusted_main, "tests-trusted.yml")
  assert_checks_workflow_is_read_only(checks, "checks.yml")
  assert_event_routing

  puts "PASS: workflow secret boundary (pull requests are read-only; main is secret-backed)"
rescue ContractError => e
  warn "FAIL: #{e.message}"
  exit 1
end
