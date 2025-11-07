import { FloatingPane } from "@/components/floating-pane";
import { useSocket } from "@/contexts/socket/use-socket";
import { stackClientApp } from "@/lib/stack";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@cmux/convex/api";

export const Route = createFileRoute("/_layout/debug")({
  component: DebugComponent,
});

function DebugComponent() {
  const { socket } = useSocket();
  const resetOnboarding = useMutation(api.onboarding.resetOnboarding);

  return (
    <FloatingPane>
      <div className="p-4">
        <button
          onClick={async () => {
            await resetOnboarding({});
            alert("Onboarding reset! Reloading...");
            window.location.reload();
          }}
          style={{
            background: "#ef4444",
            color: "white",
            padding: "8px 16px",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
            fontWeight: "600",
            marginBottom: "8px",
          }}
        >
          🔄 Reset Onboarding
        </button>

        <br />

        <button
          onClick={async () => {
            const user = await stackClientApp.getUser();
            if (!user) {
              throw new Error("No user");
            }
            const authHeaders = await user.getAuthHeaders();
            fetch("http://localhost:9779/api/user", {
              headers: {
                ...authHeaders,
              },
            })
              .then((res) => res.text())
              .then((data) => console.log(data));
          }}
        >
          Get user
        </button>

        <br />

        <button
          onClick={() => {
            socket?.emit("rust-get-time", (res) => {
              if (res.ok) {
                console.log("Rust time (ms since epoch):", res.time);
                alert(`Rust time: ${new Date(Number(res.time)).toISOString()}`);
              } else {
                console.error("Rust error:", res.error);
                alert(`Rust error: ${res.error}`);
              }
            });
          }}
        >
          Rust time
        </button>

        <br />

        <button
          onClick={() => {
            const teamSlugOrId =
              typeof window !== "undefined"
                ? window.location.pathname.split("/")[1] || "default"
                : "default";
            socket?.emit("github-fetch-repos", { teamSlugOrId }, (data) => {
              console.log(data);
            });
          }}
        >
          refetch github
        </button>

        <br />

        <button
          onClick={async () => {
            const user = await stackClientApp.getUser();
            if (!user) throw new Error("No user");
            const authHeaders = await user.getAuthHeaders();
            const res = await fetch(
              "http://localhost:9779/api/integrations/github/user",
              {
                headers: {
                  ...authHeaders,
                },
                credentials: "include",
              }
            );
            const data = await res.json();
            console.log("github user info", data);
          }}
        >
          get github email
        </button>

        {/* <button
          onClick={async () => {
            const token = await githubConnectedAccount?.getAccessToken();
            console.log(token);
          }}
        >
          get github access token
        </button> */}
      </div>
    </FloatingPane>
  );
}
