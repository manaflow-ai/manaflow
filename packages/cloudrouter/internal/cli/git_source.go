package cli

import (
	"fmt"
	"net"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
)

var githubShorthandPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\.git)?$`)

// isGitURL identifies remote sources without treating an ordinary local path
// (including a directory ending in .git) as a shell command or remote URL.
func isGitURL(value string) bool {
	return githubShorthandPattern.MatchString(value) ||
		strings.HasPrefix(value, "git@") ||
		hasSupportedGitScheme(value)
}

func hasSupportedGitScheme(value string) bool {
	for _, scheme := range []string{"https://", "ssh://", "git://"} {
		if strings.HasPrefix(strings.ToLower(value), scheme) {
			return true
		}
	}
	return false
}

// normalizeGitSource validates and canonicalizes the source before it is sent
// to the remote execution API. The API currently accepts a shell string, so
// rejecting credentials, control characters, and unsupported URL forms here
// prevents accidental secret exposure and ambiguous parser behavior.
func normalizeGitSource(raw string) (string, error) {
	if raw == "" || strings.TrimSpace(raw) != raw || strings.IndexByte(raw, 0) >= 0 || strings.ContainsAny(raw, "\r\n") {
		return "", fmt.Errorf("git source contains invalid whitespace or control characters")
	}

	if githubShorthandPattern.MatchString(raw) {
		return "https://github.com/" + raw, nil
	}

	if strings.HasPrefix(raw, "git@") {
		if !validScpGitSource(raw) {
			return "", fmt.Errorf("invalid SSH git source")
		}
		return raw, nil
	}

	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("invalid git URL")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https", "ssh", "git":
	default:
		return "", fmt.Errorf("git URL must use https, ssh, or git")
	}
	if parsed.User != nil {
		username := parsed.User.Username()
		if strings.ToLower(parsed.Scheme) != "ssh" || username != "git" {
			return "", fmt.Errorf("git URL must not contain credentials")
		}
		if _, hasPassword := parsed.User.Password(); hasPassword {
			return "", fmt.Errorf("git URL must not contain credentials")
		}
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" || parsed.Path == "" {
		return "", fmt.Errorf("git URL must not contain credentials, query parameters, or fragments")
	}
	if strings.ContainsAny(parsed.Host, "\x00\r\n\t") || strings.ContainsAny(parsed.Path, "\x00\r\n") {
		return "", fmt.Errorf("git URL contains invalid control characters")
	}
	if !validGitHost(parsed.Hostname()) {
		return "", fmt.Errorf("git URL contains an invalid host")
	}
	for _, component := range strings.Split(parsed.Path, "/") {
		if component == ".." {
			return "", fmt.Errorf("git URL path cannot contain ..")
		}
	}
	return parsed.String(), nil
}

func validScpGitSource(source string) bool {
	rest := strings.TrimPrefix(source, "git@")
	hostAndPath := strings.SplitN(rest, ":", 2)
	if len(hostAndPath) != 2 || hostAndPath[0] == "" || hostAndPath[1] == "" {
		return false
	}
	if !validGitHost(hostAndPath[0]) || strings.ContainsAny(hostAndPath[1], "\x00\r\n") {
		return false
	}
	for _, component := range strings.Split(hostAndPath[1], "/") {
		if component == ".." {
			return false
		}
	}
	return true
}

// validGitHost rejects hosts that SSH could interpret as command-line options
// and accepts only DNS-style names or IP literals. Git forwards this value to
// SSH, so a leading '-' must never reach the transport parser.
func validGitHost(host string) bool {
	if host == "" || strings.HasPrefix(host, "-") {
		return false
	}
	if net.ParseIP(host) != nil {
		return true
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') &&
				(char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func validateGitBranch(branch string) error {
	if branch == "" {
		return nil
	}
	cmd := exec.Command("git", "check-ref-format", "--branch", branch)
	if output, err := cmd.CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = "invalid branch name"
		}
		return fmt.Errorf("invalid git branch: %s", message)
	}
	return nil
}

func buildGitCloneCommand(source, branch string) (string, error) {
	return buildGitCloneCommandIn("/home/user/workspace", source, branch)
}

func buildGitCloneCommandIn(workspace, source, branch string) (string, error) {
	validatedSource, err := normalizeGitSource(source)
	if err != nil {
		return "", err
	}
	if err := validateGitBranch(branch); err != nil {
		return "", err
	}

	args := []string{"git", "-C", workspace, "clone"}
	if branch != "" {
		// Keep the option and value in one argv element. This prevents a branch
		// beginning with '-' from being reinterpreted by git after shell parsing.
		args = append(args, "--branch="+branch)
	}
	args = append(args, "--", validatedSource, ".")
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = shellQuote(arg)
	}
	return strings.Join(quoted, " "), nil
}

func gitSourceName(source string) string {
	trimmed := strings.TrimSuffix(source, ".git")
	if index := strings.LastIndexAny(trimmed, "/:"); index >= 0 {
		trimmed = trimmed[index+1:]
	}
	return trimmed
}
