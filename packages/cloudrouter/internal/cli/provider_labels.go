package cli

import (
	"fmt"
	"strings"

	"github.com/manaflow-ai/cloudrouter/internal/api"
)

const defaultVercelRuntime = "node24"

func instanceTypeLabel(inst api.Instance) string {
	switch inst.Provider {
	case "modal":
		if inst.GPU != "" {
			return fmt.Sprintf("GPU (%s)", inst.GPU)
		}
		return "GPU"
	case "vercel":
		runtime := strings.TrimSpace(inst.Runtime)
		if runtime == "" {
			return "Vercel"
		}
		return fmt.Sprintf("Vercel (%s)", runtime)
	default:
		return "Docker"
	}
}

func templateTypeLabel(t api.Template) string {
	switch t.Provider {
	case "modal":
		if t.GPU != "" {
			return fmt.Sprintf("GPU (%s)", t.GPU)
		}
		return "GPU"
	case "vercel":
		runtime := strings.TrimSpace(t.Runtime)
		if runtime == "" {
			return "Vercel"
		}
		return fmt.Sprintf("Vercel (%s)", runtime)
	default:
		return "Docker"
	}
}

func createResponseTypeLabel(resp *api.CreateInstanceResponse, requestedRuntime string) string {
	switch resp.Provider {
	case "modal":
		if resp.GPU != "" {
			return fmt.Sprintf("GPU (%s)", resp.GPU)
		}
		return "GPU"
	case "vercel":
		runtime := strings.TrimSpace(resp.Runtime)
		if runtime == "" {
			runtime = strings.TrimSpace(requestedRuntime)
		}
		if runtime == "" {
			runtime = defaultVercelRuntime
		}
		return fmt.Sprintf("Vercel (%s)", runtime)
	default:
		return "Docker"
	}
}
