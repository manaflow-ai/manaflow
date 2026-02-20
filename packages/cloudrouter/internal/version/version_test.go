package version

import "testing"

func TestIsNewer(t *testing.T) {
	tests := []struct {
		name     string
		latest   string
		current  string
		expected bool
	}{
		{
			name:     "patch version newer",
			latest:   "0.7.6",
			current:  "0.7.5",
			expected: true,
		},
		{
			name:     "minor version newer",
			latest:   "0.8.0",
			current:  "0.7.6",
			expected: true,
		},
		{
			name:     "major version newer",
			latest:   "1.0.0",
			current:  "0.7.6",
			expected: true,
		},
		{
			name:     "same version",
			latest:   "0.7.6",
			current:  "0.7.6",
			expected: false,
		},
		{
			name:     "current is newer",
			latest:   "0.7.5",
			current:  "0.7.6",
			expected: false,
		},
		{
			name:     "with v prefix",
			latest:   "v0.7.6",
			current:  "v0.7.5",
			expected: true,
		},
		{
			name:     "mixed v prefix",
			latest:   "0.7.6",
			current:  "v0.7.5",
			expected: true,
		},
		{
			name:     "more parts in latest",
			latest:   "0.7.6.1",
			current:  "0.7.6",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isNewer(tt.latest, tt.current)
			if result != tt.expected {
				t.Errorf("isNewer(%q, %q) = %v, want %v", tt.latest, tt.current, result, tt.expected)
			}
		})
	}
}

func TestPadVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"0.7.6", "0.7.6  "},
		{"0.7.10", "0.7.10 "},
		{"10.10.10", "10.10.1"}, // truncated to 7 chars
	}

	for _, tt := range tests {
		result := padVersion(tt.input)
		if result != tt.expected {
			t.Errorf("padVersion(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestIsLongRunningCommand(t *testing.T) {
	tests := []struct {
		cmd      string
		expected bool
	}{
		{"pty", true},
		{"sync", true},
		{"start", true},
		{"ls", false},
		{"exec", false},
		{"version", false},
	}

	for _, tt := range tests {
		result := IsLongRunningCommand(tt.cmd)
		if result != tt.expected {
			t.Errorf("IsLongRunningCommand(%q) = %v, want %v", tt.cmd, result, tt.expected)
		}
	}
}
