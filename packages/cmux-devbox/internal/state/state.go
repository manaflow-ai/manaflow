// Package state manages minimal local state for the cmux devbox CLI.
// Just tracks the last used instance for convenience.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
)

// State holds minimal local state
type State struct {
	LastInstanceID string `json:"lastInstanceId,omitempty"`
	LastTeamSlug   string `json:"lastTeamSlug,omitempty"`
}

// statePath returns the path to the state file
func statePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	cfg := auth.GetConfig()
	filename := "cmux_devbox_state_prod.json"
	if cfg.IsDev {
		filename = "cmux_devbox_state_dev.json"
	}

	return filepath.Join(home, ".config", "cmux", filename), nil
}

// Load loads the state file
func Load() (*State, error) {
	path, err := statePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &State{}, nil
		}
		return nil, err
	}

	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}

	return &s, nil
}

// Save saves the state file
func Save(s *State) error {
	path, err := statePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// SetLastInstance saves the last used instance
func SetLastInstance(instanceID, teamSlug string) error {
	s, _ := Load()
	if s == nil {
		s = &State{}
	}
	s.LastInstanceID = instanceID
	s.LastTeamSlug = teamSlug
	return Save(s)
}

// GetLastInstance returns the last used instance ID
func GetLastInstance() (string, string, error) {
	s, err := Load()
	if err != nil {
		return "", "", err
	}
	return s.LastInstanceID, s.LastTeamSlug, nil
}

// Clear removes the state file
func Clear() error {
	path, err := statePath()
	if err != nil {
		return err
	}
	return os.Remove(path)
}
