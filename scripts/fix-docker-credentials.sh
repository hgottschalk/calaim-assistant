#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Script to fix Docker credential helper issues by removing problematic
# settings from the Docker config.json file.

# Define file paths
CONFIG_FILE="$HOME/.docker/config.json"
BACKUP_FILE="$HOME/.docker/config.json.bak"
# Create a secure temporary file. mktemp will replace XXXXXX with random characters.
# Using $HOME/.docker/ as the directory for the temp file to keep it close,
# though /tmp is also a common choice.
TEMP_FILE=$(mktemp "$HOME/.docker/config.json.tmp.XXXXXX")

# Ensure jq is installed
if ! command -v jq &> /dev/null
then
    echo "Error: jq command-line JSON processor is not installed." >&2
    echo "Please install jq to run this script." >&2
    echo "For example:" >&2
    echo "  On macOS: brew install jq" >&2
    echo "  On Debian/Ubuntu: sudo apt-get install jq" >&2
    # Clean up temporary file if created by mktemp before exiting
    rm -f "$TEMP_FILE"
    exit 1
fi

echo "Docker Credential Fix Script"
echo "============================"

# Check if the Docker config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Docker config file not found at $CONFIG_FILE" >&2
    # Clean up temporary file if created by mktemp before exiting
    rm -f "$TEMP_FILE"
    exit 1
fi

# 1. Back up the current Docker config.json file
echo -n "Backing up '$CONFIG_FILE' to '$BACKUP_FILE'... "
if cp "$CONFIG_FILE" "$BACKUP_FILE"; then
    echo "Done."
else
    echo "Failed!" >&2
    echo "Error: Could not create backup file at $BACKUP_FILE." >&2
    # Clean up temporary file if created by mktemp before exiting
    rm -f "$TEMP_FILE"
    exit 1
fi

# 2. Remove the credHelpers and credsStore settings from the config, writing to a temporary file
echo -n "Modifying Docker configuration (removing 'credsStore' and 'credHelpers')... "
if jq 'del(.credsStore) | del(.credHelpers)' "$CONFIG_FILE" > "$TEMP_FILE"; then
    echo "Done (changes prepared in temporary file)."
else
    echo "Failed!" >&2
    echo "Error: jq command failed to process $CONFIG_FILE." >&2
    echo "Your original configuration at $CONFIG_FILE has not been changed." >&2
    echo "The backup remains at $BACKUP_FILE." >&2
    # Clean up temporary file
    rm -f "$TEMP_FILE"
    exit 1
fi

# 3. Replace the original config file with the modified temporary file
echo -n "Saving new configuration to '$CONFIG_FILE'... "
if mv "$TEMP_FILE" "$CONFIG_FILE"; then
    echo "Done."
    echo "Docker configuration updated successfully."
else
    echo "Failed!" >&2
    echo "Error: Could not move temporary file $TEMP_FILE to $CONFIG_FILE." >&2
    echo "The modified configuration is in $TEMP_FILE (if not cleaned up)." >&2
    echo "Your original configuration backup is at $BACKUP_FILE." >&2
    # Attempt to clean up temp file if mv failed but file still exists
    rm -f "$TEMP_FILE"
    exit 1
fi

echo "============================"
echo "Script finished successfully."
echo "You might need to restart Docker Desktop for changes to take full effect."
echo ""
echo "To make this script easily executable in the future, run:"
echo "  chmod +x scripts/fix-docker-credentials.sh"

# The TEMP_FILE is moved, so no explicit rm needed here on success.
# If mv fails, the script exits, and TEMP_FILE might remain, which is noted in error.
