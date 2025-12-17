const express = require('express');
const { google } = require('googleapis');
const { config } = require('../config');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

// OAuth2 client setup (only if YouTube is enabled)
let oauth2Client = null;
if (config.youtube.enabled) {
  oauth2Client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
}

/**
 * Start YouTube OAuth flow
 * GET /youtube/auth
 */
router.get('/auth', verifyFirebaseToken, async (req, res, next) => {
  try {
    // Check if YouTube is configured
    if (!config.youtube.enabled) {
      return res.status(503).json({
        success: false,
        error: {
          type: 'YOUTUBE_NOT_CONFIGURED',
          message: 'YouTube upload feature is not configured on this server'
        }
      });
    }

    const user = req.user;
    
    // Generate OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Gets refresh token
      scope: config.youtube.scopes,
      state: user.uid, // Pass user ID for callback
      prompt: 'consent' // Forces consent screen to get refresh token
    });
    
    res.json({
      success: true,
      data: {
        authUrl,
        message: 'Redirect user to this URL to authorize YouTube access'
      }
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * YouTube OAuth callback
 * GET /oauth/youtube/callback
 */
router.get('/callback', async (req, res, next) => {
  try {
    // Check if YouTube is configured
    if (!config.youtube.enabled) {
      return res.status(503).send(`
        <html>
          <body>
            <h2>YouTube Not Configured</h2>
            <p>YouTube upload feature is not available on this server.</p>
          </body>
        </html>
      `);
    }

    const { code, state: userId, error } = req.query;
    
    if (error) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>YouTube Authorization Failed</h2>
            <p>Error: ${error}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
    }
    
    if (!code || !userId) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>Invalid Authorization</h2>
            <p>Missing authorization code or user ID.</p>
          </body>
        </html>
      `);
    }
    
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store refresh token for user (you'll need to implement this storage)
    await storeUserYouTubeTokens(userId, tokens);
    
    res.send(`
      <html>
        <body>
          <h2>YouTube Authorization Successful!</h2>
          <p>You can now upload public videos to YouTube.</p>
          <p>You can close this window and return to the app.</p>
          <script>
            // Try to close window after 3 seconds
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('YouTube OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <body>
          <h2>Authorization Error</h2>
          <p>Failed to complete YouTube authorization.</p>
          <p>Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * Upload video to YouTube
 * POST /youtube/upload
 */
router.post('/upload', verifyFirebaseToken, async (req, res, next) => {
  try {
    // Check if YouTube is configured
    if (!config.youtube.enabled) {
      return res.status(503).json({
        success: false,
        error: {
          type: 'YOUTUBE_NOT_CONFIGURED',
          message: 'YouTube upload feature is not configured on this server'
        }
      });
    }

    const user = req.user;
    const { videoUrl, title, description, tags = [], privacy = 'unlisted' } = req.body;
    
    // Validate input
    if (!videoUrl || !title) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'VALIDATION_ERROR',
          message: 'videoUrl and title are required'
        }
      });
    }
    
    // Get user's YouTube tokens
    const tokens = await getUserYouTubeTokens(user.uid);
    if (!tokens || !tokens.refresh_token) {
      return res.status(401).json({
        success: false,
        error: {
          type: 'YOUTUBE_NOT_AUTHORIZED',
          message: 'User has not authorized YouTube access'
        }
      });
    }
    
    // Set up OAuth client with user tokens
    oauth2Client.setCredentials(tokens);
    
    // Create YouTube API client
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // Download video from GCS
    const videoStream = await downloadVideoFromUrl(videoUrl);
    
    // Upload to YouTube
    const uploadResponse = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.substring(0, 100), // YouTube title limit
          description: description || 'Generated with AI using Veo',
          tags: tags.slice(0, 10), // YouTube allows max 10 tags
          categoryId: '24' // Entertainment category
        },
        status: {
          privacyStatus: privacy, // public, unlisted, private
          embeddable: true,
          license: 'youtube'
        }
      },
      media: {
        body: videoStream
      }
    });
    
    const videoId = uploadResponse.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    res.json({
      success: true,
      data: {
        videoId,
        url: youtubeUrl,
        title: uploadResponse.data.snippet.title,
        description: uploadResponse.data.snippet.description,
        privacyStatus: uploadResponse.data.status.privacyStatus,
        uploadedAt: uploadResponse.data.snippet.publishedAt
      }
    });
    
  } catch (error) {
    console.error('YouTube upload error:', error);
    
    if (error.code === 401) {
      return res.status(401).json({
        success: false,
        error: {
          type: 'YOUTUBE_TOKEN_EXPIRED',
          message: 'YouTube authorization expired. Please re-authorize.'
        }
      });
    }
    
    if (error.code === 403) {
      return res.status(403).json({
        success: false,
        error: {
          type: 'YOUTUBE_QUOTA_EXCEEDED',
          message: 'YouTube API quota exceeded. Try again later.'
        }
      });
    }
    
    next(error);
  }
});

/**
 * Check YouTube authorization status
 * GET /youtube/status
 */
router.get('/status', verifyFirebaseToken, async (req, res, next) => {
  try {
    const user = req.user;
    const tokens = await getUserYouTubeTokens(user.uid);
    
    const isAuthorized = !!(tokens && tokens.refresh_token);
    
    res.json({
      success: true,
      data: {
        authorized: isAuthorized,
        authorizedAt: tokens?.created_at || null
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Helper functions (you'll need to implement these)

/**
 * Store YouTube tokens for user
 * In production, use Firestore or your preferred database
 */
async function storeUserYouTubeTokens(userId, tokens) {
  // TODO: Implement token storage
  // For now, store in memory (will be lost on restart)
  if (!global.youtubeTokens) {
    global.youtubeTokens = new Map();
  }
  
  global.youtubeTokens.set(userId, {
    ...tokens,
    created_at: new Date().toISOString()
  });
  
  console.log(`Stored YouTube tokens for user: ${userId}`);
}

/**
 * Get YouTube tokens for user
 */
async function getUserYouTubeTokens(userId) {
  // TODO: Implement token retrieval from database
  if (!global.youtubeTokens) {
    return null;
  }
  
  return global.youtubeTokens.get(userId) || null;
}

/**
 * Download video from URL (GCS signed URL)
 */
async function downloadVideoFromUrl(url) {
  const https = require('https');
  const http = require('http');
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download video: ${response.statusCode}`));
        return;
      }
      
      resolve(response);
    }).on('error', reject);
  });
}

module.exports = router;
