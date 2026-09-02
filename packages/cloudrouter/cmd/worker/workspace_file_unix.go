//go:build !windows

package main

import (
	"io"
	"os"
	"syscall"
)

const noFollowFlag = syscall.O_NOFOLLOW

func readWorkspaceFile(path string) ([]byte, error) {
	file, err := os.OpenFile(path, os.O_RDONLY|noFollowFlag, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

func readSecretFile(path string) ([]byte, error) {
	file, err := os.OpenFile(path, os.O_RDONLY|noFollowFlag, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, os.ErrPermission
	}
	return io.ReadAll(io.LimitReader(file, 4096))
}

func writeWorkspaceFile(path string, data []byte, perm os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|noFollowFlag, perm)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := file.Chmod(perm); err != nil {
		return err
	}
	_, err = file.Write(data)
	return err
}
