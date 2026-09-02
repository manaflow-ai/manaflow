//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"syscall"
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

	if os.Geteuid() != 0 {
		if os.Geteuid() != targetUID {
			return fmt.Errorf("daemon must run as %s (uid %d), got uid %d", target.Username, targetUID, os.Geteuid())
		}
		return nil
	}

	// Supplementary groups must be changed while the process still has root
	// privilege. Keep the worker's configured groups (for example, docker)
	// without retaining root's groups. Setgid/setuid then make the drop
	// irreversible for this process.
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
	if err := syscall.Setgroups(groups); err != nil {
		return fmt.Errorf("drop supplementary groups: %w", err)
	}
	if err := syscall.Setgid(targetGID); err != nil {
		return fmt.Errorf("drop gid: %w", err)
	}
	if err := syscall.Setuid(targetUID); err != nil {
		return fmt.Errorf("drop uid: %w", err)
	}
	if os.Geteuid() != targetUID || os.Getuid() != targetUID {
		return fmt.Errorf("privilege drop did not take effect")
	}
	return nil
}
