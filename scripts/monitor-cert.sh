#!/bin/bash

# Monitor GCloud certificate status and notify when it changes from PROVISIONING

CERT_NAME="cmux-app-cert"
LOCATION="global"
CHECK_INTERVAL=10  # seconds between checks

echo "🔍 Monitoring certificate: $CERT_NAME"
echo "Will check every $CHECK_INTERVAL seconds..."
echo ""

PREVIOUS_STATE="PROVISIONING"

while true; do
  CURRENT_STATE=$(gcloud certificate-manager certificates describe "$CERT_NAME" \
    --location="$LOCATION" \
    --format='value(managed.state)' 2>/dev/null)

  if [ -z "$CURRENT_STATE" ]; then
    echo "❌ Error: Could not retrieve certificate state"
    osascript -e "display notification \"Failed to retrieve certificate state\" with title \"Certificate Monitor Error\" sound name \"Basso\""
    exit 1
  fi

  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$TIMESTAMP] Current state: $CURRENT_STATE"

  if [ "$CURRENT_STATE" != "$PREVIOUS_STATE" ]; then
    echo ""
    echo "🎉 STATUS CHANGED: $PREVIOUS_STATE → $CURRENT_STATE"
    echo ""

    # Send macOS notification
    osascript -e "display notification \"$PREVIOUS_STATE → $CURRENT_STATE\" with title \"Certificate Status Changed\" sound name \"Glass\""

    if [ "$CURRENT_STATE" = "ACTIVE" ]; then
      echo "✅ Certificate is now ACTIVE!"
      exit 0
    elif [ "$CURRENT_STATE" = "FAILED" ]; then
      echo "❌ Certificate provisioning FAILED!"
      exit 1
    fi

    PREVIOUS_STATE="$CURRENT_STATE"
  fi

  sleep "$CHECK_INTERVAL"
done
