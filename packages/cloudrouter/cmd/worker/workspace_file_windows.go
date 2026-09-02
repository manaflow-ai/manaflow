//go:build windows

package main

import (
	"io"
	"os"
)

const noFollowFlag = 0

func readWorkspaceFile(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

func readSecretFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, os.ErrPermission
	}
	return os.ReadFile(path)
}

func writeWorkspaceFile(path string, data []byte, perm os.FileMode) error {
	return os.WriteFile(path, data, perm)
}
