//go:build !linux && !windows

package main

import "fmt"

func dropPrivilegesToWorkerUser() error {
	return fmt.Errorf("worker daemon is supported only on Linux sandbox images")
}
