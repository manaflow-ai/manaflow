//go:build linux && !cgo

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
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

func TestSetWorkerGroupsCoversLockedThreads(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("setting supplementary groups requires root")
	}

	expected, err := unix.Getgroups()
	if err != nil {
		t.Fatalf("get current groups: %v", err)
	}
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
			got, err := readThreadGroups(strconv.Itoa(unix.Gettid()))
			if err != nil {
				results <- err
				return
			}
			if !sameGroupSet(got, expected) {
				results <- fmt.Errorf("thread groups = %v, want %v", got, expected)
				return
			}
			results <- nil
		}()
	}
	for range threadCount {
		<-ready
	}

	if err := setWorkerGroups(expected); err != nil {
		close(check)
		t.Fatalf("set worker groups: %v", err)
	}
	close(check)
	for range threadCount {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
}

func sameGroupSet(left, right []int) bool {
	leftSet := make(map[int]struct{}, len(left))
	for _, gid := range left {
		leftSet[gid] = struct{}{}
	}
	rightSet := make(map[int]struct{}, len(right))
	for _, gid := range right {
		rightSet[gid] = struct{}{}
	}
	if len(leftSet) != len(rightSet) {
		return false
	}
	for gid := range leftSet {
		if _, ok := rightSet[gid]; !ok {
			return false
		}
	}
	return true
}
