//go:build linux

package main

import (
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// dropPrivilegesToWorkerUser makes the daemon's privilege boundary explicit.
// The template starts the binary as the dedicated user, while this check also
// protects against a deployment that accidentally starts it as root.
func dropPrivilegesToWorkerUser() error {
	target, err := user.Lookup("user")
	if err != nil {
		return fmt.Errorf("lookup worker account: %w", err)
	}
	targetUID, err := strconv.Atoi(target.Uid)
	if err != nil {
		return fmt.Errorf("parse worker uid: %w", err)
	}
	targetGID, err := strconv.Atoi(target.Gid)
	if err != nil {
		return fmt.Errorf("parse worker gid: %w", err)
	}
	if targetUID <= 0 {
		return fmt.Errorf("worker account must have a non-root uid")
	}
	if targetGID <= 0 {
		return fmt.Errorf("worker account must have a non-root primary gid")
	}

	_, euid, _ := unix.Getresuid()
	_, egid, _ := unix.Getresgid()
	if euid != 0 && euid != targetUID {
		return fmt.Errorf("daemon must run as %s (uid %d), got uid %d", target.Username, targetUID, euid)
	}
	if egid != 0 && egid != targetGID {
		return fmt.Errorf("daemon must run with gid %d, got gid %d", targetGID, egid)
	}

	// Supplementary groups must be changed while the process still has root
	// privilege. Keep the worker's configured groups (for example, docker)
	// without retaining root's groups.
	if euid == 0 {
		// Do not carry capabilities across the identity transition. A retained
		// capability can bypass the UID checks below and recreate a root shell.
		if _, err := allThreadsPrctl(unix.PR_SET_KEEPCAPS, 0); err != nil {
			return fmt.Errorf("disable retained capabilities: %w", err)
		}
		if _, err := allThreadsPrctl(unix.PR_CAP_AMBIENT, unix.PR_CAP_AMBIENT_CLEAR_ALL); err != nil && err != syscall.EINVAL {
			return fmt.Errorf("clear ambient capabilities: %w", err)
		}
		for capability := 0; capability <= unix.CAP_LAST_CAP; capability++ {
			_, err := allThreadsPrctl(unix.PR_CAPBSET_DROP, uintptr(capability))
			if err != nil && err != syscall.EINVAL {
				return fmt.Errorf("drop capability %d from bounding set: %w", capability, err)
			}
		}
		groupIDs, err := target.GroupIds()
		if err != nil {
			return fmt.Errorf("lookup worker groups: %w", err)
		}
		groups := make([]int, 0, len(groupIDs)+1)
		seen := make(map[int]struct{}, len(groupIDs)+1)
		for _, groupID := range append(groupIDs, target.Gid) {
			gid, err := strconv.Atoi(groupID)
			if err != nil {
				return fmt.Errorf("parse worker group id: %w", err)
			}
			if gid <= 0 {
				return fmt.Errorf("worker account must not belong to a privileged group")
			}
			if _, ok := seen[gid]; ok {
				continue
			}
			seen[gid] = struct{}{}
			groups = append(groups, gid)
		}
		if err := setWorkerGroups(groups); err != nil {
			return fmt.Errorf("drop supplementary groups: %w", err)
		}
	} else if err := rejectRootSupplementaryGroup(); err != nil {
		return err
	}
	if euid != 0 {
		if err := rejectLinuxCapabilities(false); err != nil {
			return err
		}
	}

	// Set all three credential slots, not only the effective IDs. This clears a
	// retained root real or saved ID from a setuid/capability-based launcher.
	if err := unix.Setresgid(targetGID, targetGID, targetGID); err != nil {
		return fmt.Errorf("drop gid credentials: %w", err)
	}
	if err := unix.Setresuid(targetUID, targetUID, targetUID); err != nil {
		return fmt.Errorf("drop uid credentials: %w", err)
	}

	checkRUID, checkEUID, checkSUID := unix.Getresuid()
	checkRGID, checkEGID, checkSGID := unix.Getresgid()
	if checkRUID != targetUID || checkEUID != targetUID || checkSUID != targetUID ||
		checkRGID != targetGID || checkEGID != targetGID || checkSGID != targetGID {
		return fmt.Errorf("privilege drop did not clear all credentials")
	}
	if err := rejectLinuxCapabilities(euid == 0); err != nil {
		return err
	}
	if err := setNoNewPrivileges(); err != nil {
		return err
	}
	return nil
}

// setNoNewPrivileges prevents a later exec from gaining privilege through a
// set-user-ID bit or file capability. It is irreversible for this process and
// its children, so fail closed when the kernel cannot enforce it.
func setNoNewPrivileges() error {
	if _, err := allThreadsPrctl(unix.PR_SET_NO_NEW_PRIVS, 1); err != nil {
		return fmt.Errorf("set no-new-privileges on all threads: %w", err)
	}
	value, err := allThreadsPrctl(unix.PR_GET_NO_NEW_PRIVS, 0)
	if err != nil {
		return fmt.Errorf("verify no-new-privileges on all threads: %w", err)
	}
	if value != 1 {
		return fmt.Errorf("no-new-privileges is not enabled on every thread")
	}
	return nil
}

// allThreadsPrctl applies a prctl operation to every Go runtime thread. Linux
// stores capability and no-new-privileges state per thread, so a one-thread
// syscall would leave a runtime thread able to regain privilege. The worker is
// built with CGO_ENABLED=0 because the runtime cannot enumerate C-created
// threads safely.
func allThreadsPrctl(option, arg2 uintptr) (uintptr, error) {
	value, _, errno := syscall.AllThreadsSyscall6(
		syscall.SYS_PRCTL,
		option,
		arg2,
		0,
		0,
		0,
		0,
	)
	if errno != 0 {
		return 0, errno
	}
	return value, nil
}

// setWorkerGroups updates supplementary groups on every Go runtime thread.
// syscall.Setgroups uses Go's all-thread syscall path for static Linux builds;
// unix.Setgroups would invoke the raw syscall on only the current thread.
func setWorkerGroups(groups []int) error {
	if err := syscall.Setgroups(groups); err != nil {
		return err
	}
	return verifyWorkerGroups(groups)
}

func rejectRootSupplementaryGroup() error {
	threads, err := os.ReadDir("/proc/self/task")
	if err != nil {
		return fmt.Errorf("inspect worker threads: %w", err)
	}
	for _, thread := range threads {
		groups, err := readThreadGroups(thread.Name())
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		for _, gid := range groups {
			if gid == 0 {
				return fmt.Errorf("worker thread %s retains the root supplementary group", thread.Name())
			}
		}
	}
	return nil
}

func verifyWorkerGroups(expected []int) error {
	want := make(map[int]struct{}, len(expected))
	for _, gid := range expected {
		want[gid] = struct{}{}
	}
	threads, err := os.ReadDir("/proc/self/task")
	if err != nil {
		return fmt.Errorf("inspect worker threads: %w", err)
	}
	for _, thread := range threads {
		groups, err := readThreadGroups(thread.Name())
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		got := make(map[int]struct{}, len(groups))
		for _, gid := range groups {
			got[gid] = struct{}{}
		}
		if len(got) != len(want) {
			return fmt.Errorf("worker thread %s has unexpected supplementary groups", thread.Name())
		}
		for gid := range want {
			if _, ok := got[gid]; !ok {
				return fmt.Errorf("worker thread %s has unexpected supplementary groups", thread.Name())
			}
		}
	}
	return nil
}

func readThreadGroups(threadID string) ([]int, error) {
	status, err := os.ReadFile(filepath.Join("/proc/self/task", threadID, "status"))
	if err != nil {
		return nil, fmt.Errorf("inspect supplementary groups for thread %s: %w", threadID, err)
	}
	for _, line := range strings.Split(string(status), "\n") {
		if !strings.HasPrefix(line, "Groups:") {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(line, "Groups:"))
		groups := make([]int, 0, len(fields))
		for _, field := range fields {
			gid, err := strconv.ParseUint(field, 10, 32)
			if err != nil {
				return nil, fmt.Errorf("parse supplementary group %q for thread %s: %w", field, threadID, err)
			}
			groups = append(groups, int(gid))
		}
		return groups, nil
	}
	return nil, fmt.Errorf("thread %s status has no supplementary group list", threadID)
}

// rejectLinuxCapabilities checks every Go runtime thread. A non-root process
// may inherit a non-zero bounding set from its container while having no
// usable capabilities, so the bounding set is required to be empty only on a
// root-to-worker transition (which also enables no-new-privileges below).
func rejectLinuxCapabilities(checkBoundingSet bool) error {
	threads, err := os.ReadDir("/proc/self/task")
	if err != nil {
		return fmt.Errorf("inspect worker threads: %w", err)
	}
	for _, thread := range threads {
		status, err := os.ReadFile(filepath.Join("/proc/self/task", thread.Name(), "status"))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return fmt.Errorf("inspect capabilities for thread %s: %w", thread.Name(), err)
		}
		for _, line := range strings.Split(string(status), "\n") {
			fields := []string{"CapInh:", "CapPrm:", "CapEff:", "CapAmb:"}
			if checkBoundingSet {
				fields = append(fields, "CapBnd:")
			}
			for _, field := range fields {
				if !strings.HasPrefix(line, field) {
					continue
				}
				value, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, field)), 16, 64)
				if err != nil {
					return fmt.Errorf("parse %s capability set for thread %s: %w", strings.TrimSuffix(field, ":"), thread.Name(), err)
				}
				if value != 0 {
					return fmt.Errorf("worker thread %s retains %s capabilities", thread.Name(), strings.TrimSuffix(field, ":"))
				}
			}
		}
	}
	return nil
}
