# Deployment Guide

Complete step-by-step guide to deploy the Veo Backend with Firebase Authentication to Google Cloud Run.

## Prerequisites

- Google Cloud account with billing enabled
- Firebase project (same as your Android app uses)
- `gcloud` CLI installed and configured
- Docker installed (for local testing)

## Step 1: Initial Setup

```bash
# Set your project ID (should match Firebase project)
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE_NAME="veo-backend"

# Configure gcloud
gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

## Step 2: Enable Required APIs

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  iam.googleapis.com \
  firebase.googleapis.com
```

## Step 3: Create GCS Bucket (Temporary Video Storage)

```bash
# Create bucket for temporary video storage
gsutil mb -l $REGION gs://${PROJECT_ID}-veo-videos

# Set lifecycle policy (auto-delete after 1 day - videos are temporary)
cat > lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 1}
      }
    ]
  }
}
EOF
gsutil lifecycle set lifecycle.json gs://${PROJECT_ID}-veo-videos
```

## Step 4: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create veo-backend-sa \
  --display-name="Veo Backend Service Account"

SA_EMAIL="veo-backend-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant Vertex AI User role (for Veo 3)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/aiplatform.user"

# Grant Storage Object Admin role (for video storage)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# Grant Service Account Token Creator (for signed URLs)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator"

# Grant Firebase Auth Admin (for token verification) - IMPORTANT
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/firebaseauth.admin"
```

## Step 5: Build and Deploy

### Option A: Using Cloud Build

```bash
# Build and push image
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --platform managed \
  --service-account $SA_EMAIL \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT_ID" \
  --set-env-vars "GCP_REGION=$REGION" \
  --set-env-vars "FIREBASE_PROJECT_ID=$PROJECT_ID" \
  --set-env-vars "GCS_BUCKET_NAME=${PROJECT_ID}-veo-videos" \
  --set-env-vars "USER_DAILY_QUOTA=50" \
  --memory 1Gi \
  --cpu 2 \
  --timeout 300s \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 10 \
  --allow-unauthenticated
```

**Note:** `--allow-unauthenticated` is needed because authentication is handled by Firebase tokens at the application level, not Cloud Run IAM.

### Option B: Using Artifact Registry (Recommended)

```bash
# Create Artifact Registry repository
gcloud artifacts repositories create veo-backend \
  --repository-format=docker \
  --location=$REGION

# Configure Docker authentication
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Build and push
docker build -t ${REGION}-docker.pkg.dev/$PROJECT_ID/veo-backend/$SERVICE_NAME:latest .
docker push ${REGION}-docker.pkg.dev/$PROJECT_ID/veo-backend/$SERVICE_NAME:latest

# Deploy
gcloud run deploy $SERVICE_NAME \
  --image ${REGION}-docker.pkg.dev/$PROJECT_ID/veo-backend/$SERVICE_NAME:latest \
  --region $REGION \
  --platform managed \
  --service-account $SA_EMAIL \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,FIREBASE_PROJECT_ID=$PROJECT_ID,GCS_BUCKET_NAME=${PROJECT_ID}-veo-videos,USER_DAILY_QUOTA=50" \
  --memory 1Gi \
  --cpu 2 \
  --timeout 300s \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 10 \
  --allow-unauthenticated
```

## Step 6: Get Service URL

```bash
# Get the deployed URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
  --region $REGION \
  --format 'value(status.url)')

echo "Service URL: $SERVICE_URL"
```

## Step 7: Verify Deployment

```bash
# Health check (no auth required)
curl $SERVICE_URL/v1/health

# Test with Firebase token (get token from your Android app)
# This should return 401 without valid token
curl -X POST "$SERVICE_URL/v1/video/text" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
```

## Step 8: Configure Android App

Update your Android app with the Cloud Run URL:

```kotlin
// In your app's configuration
object ApiConfig {
    const val VEO_BASE_URL = "https://veo-backend-xxxxx-uc.a.run.app"
}
```

## IAM Roles Summary

| Role | Purpose |
|------|---------|
| `roles/aiplatform.user` | Access Vertex AI Veo 3 API |
| `roles/storage.objectAdmin` | Read/write videos to GCS |
| `roles/iam.serviceAccountTokenCreator` | Generate signed URLs |
| `roles/firebaseauth.admin` | Verify Firebase ID tokens |

## Cloud Run Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| Memory | 1Gi | Sufficient for API processing |
| CPU | 2 | Handle concurrent requests |
| Timeout | 300s | Allow for Veo API calls |
| Concurrency | 80 | Multiple requests per instance |
| Min Instances | 0 | Cost savings (scale to zero) |
| Max Instances | 10 | Limit costs |

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GCP_PROJECT_ID` | Google Cloud project ID | `my-project` |
| `GCP_REGION` | GCP region | `us-central1` |
| `FIREBASE_PROJECT_ID` | Firebase project ID | `my-project` |
| `GCS_BUCKET_NAME` | GCS bucket for videos | `my-project-veo-videos` |
| `USER_DAILY_QUOTA` | Daily video limit per user | `50` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per minute | `100` |

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Login to GCP (for Application Default Credentials)
gcloud auth application-default login

# Run locally
npm run dev
```

For local testing with Firebase Auth:
1. Use Firebase Auth Emulator, OR
2. Get a real ID token from your Android app and use it in requests

## Monitoring

### View Logs

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" \
  --limit 50 \
  --format "table(timestamp,jsonPayload.message,jsonPayload.uid)"
```

### Monitor Quota Usage

Check logs for quota-related entries:

```bash
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.message=~'Quota'" \
  --limit 20
```

## Updating the Deployment

```bash
# Rebuild and redeploy
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME
gcloud run deploy $SERVICE_NAME --image gcr.io/$PROJECT_ID/$SERVICE_NAME
```

## Rollback

```bash
# List revisions
gcloud run revisions list --service $SERVICE_NAME --region $REGION

# Rollback to specific revision
gcloud run services update-traffic $SERVICE_NAME \
  --region $REGION \
  --to-revisions REVISION_NAME=100
```

## Troubleshooting

### 401 Unauthorized

- Verify Firebase ID token is valid and not expired
- Check that `Authorization: Bearer <token>` header is correct
- Ensure service account has `roles/firebaseauth.admin`

### 403 from Vertex AI

- Verify service account has `roles/aiplatform.user`
- Check that Vertex AI API is enabled
- Verify region supports Veo 3

### Signed URL Issues

- Ensure service account has `roles/iam.serviceAccountTokenCreator`
- Check GCS bucket permissions

### Firebase Token Verification Fails

- Verify `FIREBASE_PROJECT_ID` matches your Firebase project
- Check service account has Firebase Auth permissions
- Ensure Application Default Credentials are working

## Cost Optimization

1. **Scale to Zero**: Keep `min-instances: 0`
2. **GCS Lifecycle**: Auto-delete videos after 1 day
3. **User Quotas**: Limit generations per user (default: 50/day)
4. **Rate Limiting**: Prevent abuse (10 videos/minute per user)
5. **Duration**: Use 4-second videos for previews
