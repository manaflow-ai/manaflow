package cli

import (
	"strings"

	"github.com/manaflow-ai/cloudrouter/internal/telemetry"
)

func captureTeamEvent(teamSlug, event string, properties map[string]interface{}) {
	trimmedTeamSlug := strings.TrimSpace(teamSlug)

	mergedProps := make(map[string]interface{}, len(properties)+1)
	if trimmedTeamSlug != "" {
		mergedProps["team_slug"] = trimmedTeamSlug
	}
	for key, value := range properties {
		mergedProps[key] = value
	}

	telemetry.Capture(event, mergedProps)
}
