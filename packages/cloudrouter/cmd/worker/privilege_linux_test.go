//go:build linux && !cgo

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestSetNoNewPrivileges(t *testing.T) {
	if os.Getenv("CMUX_NO_NEW_PRIVILEGES_CHILD") == "1" {
		const threadCount = 4
		ready := make(chan struct{}, threadCount)
		check := make(chan struct{})
		results := make(chan error, threadCount)
		for range threadCount {
			go func() {
				runtime.LockOSThread()
				defer runtime.UnlockOSThread()
				ready <- struct{}{}
				<-check
				value, err := unix.PrctlRetInt(unix.PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0)
				if err != nil {
					results <- fmt.Errorf("read no-new-privileges: %w", err)
					return
				}
				if value != 1 {
					results <- fmt.Errorf("no-new-privileges = %d, want 1", value)
					return
				}
				results <- nil
			}()
		}
		for range threadCount {
			<-ready
		}

		if err := setNoNewPrivileges(); err != nil {
			close(check)
			t.Fatal(err)
		}
		close(check)
		for range threadCount {
			if err := <-results; err != nil {
				t.Error(err)
			}
		}
		return
	}

	child := exec.Command(os.Args[0], "-test.run=^TestSetNoNewPrivileges$")
	child.Env = append(os.Environ(), "CMUX_NO_NEW_PRIVILEGES_CHILD=1")
	output, err := child.CombinedOutput()
	if err != nil {
		t.Fatalf("child no-new-privileges test failed: %v\n%s", err, strings.TrimSpace(string(output)))
	}
}
