#!/bin/bash
# Veo Backend API - cURL Examples with Firebase Authentication
# Replace YOUR_API_URL and FIREBASE_ID_TOKEN with actual values

API_URL="${VEO_API_URL:-http://localhost:8080}"
# Get Firebase ID Token from your Android app or Firebase Auth emulator
FIREBASE_TOKEN="${FIREBASE_ID_TOKEN:-your-firebase-id-token}"

echo "=== Veo Video Generation API - cURL Examples ==="
echo "API URL: $API_URL"
echo "Note: All video endpoints require Firebase ID Token"
echo ""

# Health Check (No auth required)
health_check() {
    echo ">>> Health Check (No auth required)"
    curl -s "$API_URL/v1/health" | jq .
    echo ""
}

# Get Supported Modes
get_modes() {
    echo ">>> Get Supported Modes"
    curl -s "$API_URL/v1/video/modes" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" | jq .
    echo ""
}

# Text-to-Video Generation
text_to_video() {
    echo ">>> Text-to-Video Generation"
    curl -s -X POST "$API_URL/v1/video/text" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" \
        -d '{
            "prompt": "A golden retriever puppy playing in autumn leaves, cinematic lighting, slow motion",
            "durationSeconds": 6,
            "aspectRatio": "16:9",
            "cameraStyle": "cinematic",
            "motionLevel": "medium",
            "lighting": "natural",
            "quality": "high",
            "generateAudio": true
        }' | jq .
    echo ""
}

# Text-to-Video (Minimal Request)
text_to_video_minimal() {
    echo ">>> Text-to-Video (Minimal)"
    curl -s -X POST "$API_URL/v1/video/text" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" \
        -d '{
            "prompt": "Ocean waves crashing on a rocky shore at sunset"
        }' | jq .
    echo ""
}

# Text-to-Video (Vertical for Shorts/Reels)
text_to_video_vertical() {
    echo ">>> Text-to-Video (Vertical 9:16)"
    curl -s -X POST "$API_URL/v1/video/text" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" \
        -d '{
            "prompt": "A person walking through a neon-lit city street at night, rain falling",
            "durationSeconds": 8,
            "aspectRatio": "9:16",
            "cameraStyle": "handheld",
            "lighting": "dramatic"
        }' | jq .
    echo ""
}

# Check Job Status
check_status() {
    local JOB_ID="$1"
    if [ -z "$JOB_ID" ]; then
        echo "Usage: check_status <job_id>"
        return 1
    fi
    
    echo ">>> Check Job Status: $JOB_ID"
    curl -s "$API_URL/v1/video/status/$JOB_ID" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" | jq .
    echo ""
}

# Poll until completion
poll_completion() {
    local JOB_ID="$1"
    local MAX_ATTEMPTS="${2:-60}"
    local INTERVAL="${3:-5}"
    
    if [ -z "$JOB_ID" ]; then
        echo "Usage: poll_completion <job_id> [max_attempts] [interval_seconds]"
        return 1
    fi
    
    echo ">>> Polling job $JOB_ID (max $MAX_ATTEMPTS attempts, ${INTERVAL}s interval)"
    
    for i in $(seq 1 $MAX_ATTEMPTS); do
        RESPONSE=$(curl -s "$API_URL/v1/video/status/$JOB_ID" \
            -H "Authorization: Bearer $FIREBASE_TOKEN")
        
        STATUS=$(echo "$RESPONSE" | jq -r '.data.status')
        
        echo "Attempt $i: Status = $STATUS"
        
        if [ "$STATUS" = "COMPLETED" ]; then
            echo ""
            echo "=== VIDEO READY ==="
            echo "$RESPONSE" | jq .
            echo ""
            echo "Download URL (expires in 1 hour):"
            echo "$RESPONSE" | jq -r '.data.result.signedUrl'
            return 0
        elif [ "$STATUS" = "FAILED" ]; then
            echo ""
            echo "=== GENERATION FAILED ==="
            echo "$RESPONSE" | jq .
            return 1
        fi
        
        sleep $INTERVAL
    done
    
    echo "Timeout waiting for video completion"
    return 1
}

# Image-to-Video (requires base64 image)
image_to_video() {
    local IMAGE_PATH="$1"
    
    if [ -z "$IMAGE_PATH" ] || [ ! -f "$IMAGE_PATH" ]; then
        echo "Usage: image_to_video <image_path>"
        echo "Example: image_to_video ./my-image.png"
        return 1
    fi
    
    echo ">>> Image-to-Video Generation"
    
    # Get MIME type
    MIME_TYPE="image/png"
    case "$IMAGE_PATH" in
        *.jpg|*.jpeg) MIME_TYPE="image/jpeg" ;;
        *.webp) MIME_TYPE="image/webp" ;;
    esac
    
    # Encode image to base64
    IMAGE_BASE64=$(base64 -w 0 "$IMAGE_PATH" 2>/dev/null || base64 -i "$IMAGE_PATH")
    
    curl -s -X POST "$API_URL/v1/video/image" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $FIREBASE_TOKEN" \
        -d "{
            \"prompt\": \"The scene slowly comes to life with gentle movement\",
            \"imageBase64\": \"$IMAGE_BASE64\",
            \"imageMimeType\": \"$MIME_TYPE\",
            \"durationSeconds\": 4,
            \"aspectRatio\": \"16:9\"
        }" | jq .
    echo ""
}

# Test authentication error
test_no_auth() {
    echo ">>> Test without authentication (should fail)"
    curl -s -X POST "$API_URL/v1/video/text" \
        -H "Content-Type: application/json" \
        -d '{"prompt": "test"}' | jq .
    echo ""
}

# Run examples
case "$1" in
    health)
        health_check
        ;;
    modes)
        get_modes
        ;;
    text)
        text_to_video
        ;;
    text-minimal)
        text_to_video_minimal
        ;;
    text-vertical)
        text_to_video_vertical
        ;;
    status)
        check_status "$2"
        ;;
    poll)
        poll_completion "$2" "$3" "$4"
        ;;
    image)
        image_to_video "$2"
        ;;
    test-no-auth)
        test_no_auth
        ;;
    all)
        health_check
        get_modes
        text_to_video_minimal
        ;;
    *)
        echo "Usage: $0 {health|modes|text|text-minimal|text-vertical|status|poll|image|test-no-auth|all}"
        echo ""
        echo "Commands:"
        echo "  health         - Health check endpoint (no auth required)"
        echo "  modes          - Get supported video modes"
        echo "  text           - Full text-to-video request"
        echo "  text-minimal   - Minimal text-to-video request"
        echo "  text-vertical  - Vertical video (9:16) for Shorts/Reels"
        echo "  status <id>    - Check job status"
        echo "  poll <id>      - Poll until completion"
        echo "  image <path>   - Image-to-video generation"
        echo "  test-no-auth   - Test request without auth (should fail)"
        echo "  all            - Run health, modes, and minimal text example"
        echo ""
        echo "Environment variables:"
        echo "  VEO_API_URL        - API URL (default: http://localhost:8080)"
        echo "  FIREBASE_ID_TOKEN  - Firebase ID Token from your app"
        echo ""
        echo "To get a Firebase ID Token for testing:"
        echo "  1. Use Firebase Auth emulator"
        echo "  2. Or get from your Android app: FirebaseAuth.getInstance().currentUser?.getIdToken(false)"
        ;;
esac
