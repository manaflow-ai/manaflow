//go:build linux

package main

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"strings"

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
	if targetUID == 0 {
		return fmt.Errorf("worker account must not be root")
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
		if err := unix.Prctl(unix.PR_SET_KEEPCAPS, 0, 0, 0, 0); err != nil {
			return fmt.Errorf("disable retained capabilities: %w", err)
		}
		if err := unix.Prctl(unix.PR_CAP_AMBIENT, unix.PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0); err != nil && err != unix.EINVAL {
			return fmt.Errorf("clear ambient capabilities: %w", err)
		}
		for capability := 0; capability <= unix.CAP_LAST_CAP; capability++ {
			err := unix.Prctl(unix.PR_CAPBSET_DROP, uintptr(capability), 0, 0, 0)
			if err != nil && err != unix.EINVAL {
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
			if gid == 0 {
				return fmt.Errorf("worker account must not belong to the root group")
			}
			if _, ok := seen[gid]; ok {
				continue
			}
			seen[gid] = struct{}{}
			groups = append(groups, gid)
		}
		if err := unix.Setgroups(groups); err != nil {
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
	return nil
}

func rejectRootSupplementaryGroup() error {
	groups, err := unix.Getgroups()
	if err != nil {
		return fmt.Errorf("inspect supplementary groups: %w", err)
	}
	for _, gid := range groups {
		if gid == 0 {
			return fmt.Errorf("daemon retains the root supplementary group")
		}
	}
	return nil
}

func rejectLinuxCapabilities(checkBoundingSet bool) error {
	status, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return fmt.Errorf("inspect process capabilities: %w", err)
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
				return fmt.Errorf("parse %s capability set: %w", strings.TrimSuffix(field, ":"), err)
			}
			if value != 0 {
				return fmt.Errorf("worker retains %s capabilities", strings.TrimSuffix(field, ":"))
			}
		}
	}
	return nil
}
