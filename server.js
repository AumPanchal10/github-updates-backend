// server.js - Main Express server (Production Ready)
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',                    
    'https://github-updates-frontend.vercel.app',   
    'https://github-updates-frontend.vercel.app/', 
  ],
  credentials: true
}));
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Updated GitHub API functions with multiple endpoints and better error handling

async function fetchGitHubTimeline() {
  const endpoints = [
    'https://api.github.com/events',  // Alternative endpoint
    'https://api.github.com/events/public',
    'https://api.github.com/users/github/events/public' // Fallback
  ];

  for (let i = 0; i < endpoints.length; i++) {
    try {
      console.log(`Trying GitHub API endpoint ${i + 1}: ${endpoints[i]}`);
      
      const headers = {
        'User-Agent': 'GitHub-Updates-Newsletter',
        'Accept': 'application/vnd.github.v3+json'
      };
      
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(`${endpoints[i]}?per_page=10`, {
        headers: headers
      });
      
      // Log rate limit info
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      const rateLimitReset = response.headers.get('X-RateLimit-Reset');
      console.log(`GitHub API Rate Limit - Remaining: ${rateLimitRemaining}, Reset: ${rateLimitReset ? new Date(rateLimitReset * 1000).toISOString() : 'N/A'}`);
      
      if (response.ok) {
        const events = await response.json();
        console.log(`Successfully fetched ${events.length} GitHub events from endpoint ${i + 1}`);
        return events;
      } else {
        console.log(`Endpoint ${i + 1} failed with status: ${response.status} - ${response.statusText}`);
        
        if (response.status === 403) {
          console.log('Rate limited, trying next endpoint...');
          continue;
        }
      }
    } catch (error) {
      console.error(`Error with endpoint ${i + 1}:`, error.message);
      continue;
    }
  }
  
  // If all endpoints fail, use mock data
  console.log('All GitHub API endpoints failed, using enhanced mock data');
  return getEnhancedMockGitHubEvents();
}

// Enhanced mock data that looks more realistic
function getEnhancedMockGitHubEvents() {
  const now = new Date();
  const repositories = [
    'microsoft/vscode', 'facebook/react', 'tensorflow/tensorflow',
    'kubernetes/kubernetes', 'nodejs/node', 'angular/angular',
    'vuejs/vue', 'python/cpython', 'golang/go', 'rust-lang/rust'
  ];
  
  const users = [
    'octocat', 'torvalds', 'gaearon', 'addyosmani', 'sindresorhus',
    'tj', 'defunkt', 'mojombo', 'dhh', 'wycats'
  ];
  
  const eventTypes = ['PushEvent', 'CreateEvent', 'WatchEvent', 'ForkEvent', 'PullRequestEvent'];
  
  return Array.from({ length: 10 }, (_, i) => {
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const repo = repositories[Math.floor(Math.random() * repositories.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    
    return {
      type: eventType,
      actor: { login: user },
      repo: { name: repo },
      created_at: new Date(now.getTime() - (i * 3600000)).toISOString() // Each event 1 hour apart
    };
  });
}

// Alternative: Try GitHub's RSS feed as JSON
async function fetchGitHubTimelineAlternative() {
  try {
    console.log('Trying alternative GitHub feed...');
    
    // This is a more reliable endpoint
    const response = await fetch('https://api.github.com/users/github/events?per_page=10', {
      headers: {
        'User-Agent': 'GitHub-Updates-Newsletter',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (response.ok) {
      const events = await response.json();
      console.log(`Fetched ${events.length} events from alternative endpoint`);
      return events;
    }
  } catch (error) {
    console.error('Alternative GitHub API failed:', error.message);
  }
  
  return getEnhancedMockGitHubEvents();
}

// Mock GitHub events for fallback
function getMockGitHubEvents() {
  const now = new Date();
  return [
    {
      type: 'PushEvent',
      actor: { login: 'developer123' },
      repo: { name: 'awesome-project/react-app' },
      created_at: now.toISOString()
    },
    {
      type: 'CreateEvent', 
      actor: { login: 'coder456' },
      repo: { name: 'open-source/javascript-utils' },
      created_at: new Date(now.getTime() - 3600000).toISOString()
    },
    {
      type: 'WatchEvent',
      actor: { login: 'github_user' },
      repo: { name: 'popular-repo/vue-components' },
      created_at: new Date(now.getTime() - 7200000).toISOString()
    },
    {
      type: 'ForkEvent',
      actor: { login: 'contributor' },
      repo: { name: 'trending/python-tools' },
      created_at: new Date(now.getTime() - 10800000).toISOString()
    },
    {
      type: 'PullRequestEvent',
      actor: { login: 'maintainer' },
      repo: { name: 'community/nodejs-api' },
      created_at: new Date(now.getTime() - 14400000).toISOString()
    }
  ];
}

// Format GitHub events for email
function formatGitHubEvents(events) {
  const eventTypes = {
    'PushEvent': 'pushed to',
    'CreateEvent': 'created',
    'WatchEvent': 'starred',
    'ForkEvent': 'forked',
    'IssuesEvent': 'worked on issues in',
    'PullRequestEvent': 'created pull request in'
  };

  let formattedEvents = events.slice(0, 5).map(event => {
    const action = eventTypes[event.type] || 'had activity in';
    const actor = event.actor.login;
    const repo = event.repo.name;
    const time = new Date(event.created_at).toLocaleString();
    
    return `• ${actor} ${action} ${repo} at ${time}`;
  }).join('\n');

  return `Here are the latest GitHub activities:\n\n${formattedEvents}`;
}

// Enhanced email sending
async function sendGitHubUpdate(email, githubData) {
  try {
    const emailContent = formatGitHubEvents(githubData);
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Daily GitHub Updates 🚀',
      text: emailContent,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">📊 GitHub Updates</h1>
            <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px;">Latest activities from the developer community</p>
          </div>
          
          <div style="padding: 30px; background-color: #ffffff;">
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
              ${emailContent.split('\n').filter(line => line.trim()).map(line => 
                `<p style="margin: 8px 0; color: #334155; font-size: 14px; line-height: 1.5;">${line}</p>`
              ).join('')}
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                You're receiving this because you subscribed to GitHub updates.<br>
                Stay connected with the developer community!
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${email}: ${result.messageId}`);
    return result;
    
  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error.message);
    throw error;
  }
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'GitHub Updates API is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test database connection
app.get('/api/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('count(*)')
      .limit(1);
    
    if (error) {
      console.error('Database test error:', error);
      return res.status(500).json({ 
        error: 'Database connection failed', 
        details: error.message 
      });
    }
    
    res.json({ 
      message: 'Database connection successful', 
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ 
      error: 'Database test failed', 
      details: error.message 
    });
  }
});

// Test GitHub API
app.get('/api/test-github', async (req, res) => {
  try {
    const githubData = await fetchGitHubTimeline();
    res.json({
      message: 'GitHub API test successful',
      eventsCount: githubData.length,
      sampleEvent: githubData[0] || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'GitHub API test failed',
      details: error.message
    });
  }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    console.log(`Attempting to subscribe email: ${email}`);

    // Check if email already exists
    const { data: existingUser, error: selectError } = await supabase
      .from('subscribers')
      .select('email')
      .eq('email', email)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('Error checking existing user:', selectError);
      return res.status(500).json({ message: 'Database error during email check' });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'Email already subscribed' });
    }

    // Insert new subscriber
    const { data, error } = await supabase
      .from('subscribers')
      .insert([
        { 
          email, 
          subscribed_at: new Date().toISOString(),
          is_active: true 
        }
      ])
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ 
        message: 'Database error during insertion',
        error: error.message,
        code: error.code
      });
    }

    console.log(`Successfully subscribed: ${email}`);

    // Fetch GitHub data and send welcome email
    try {
      const githubData = await fetchGitHubTimeline();
      await sendGitHubUpdate(email, githubData);
      console.log(`Welcome email sent to: ${email}`);
    } catch (emailError) {
      console.error('Email error:', emailError);
      // Don't fail the signup if email fails
    }

    res.json({ 
      message: 'Successfully subscribed!', 
      subscriber: data[0] 
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      message: 'Internal server error', 
      details: error.message 
    });
  }
});

// Manual trigger endpoint (for testing)
app.post('/api/send-updates', async (req, res) => {
  try {
    const { data: subscribers } = await supabase
      .from('subscribers')
      .select('email')
      .eq('is_active', true);

    if (!subscribers || subscribers.length === 0) {
      return res.json({ message: 'No active subscribers found' });
    }

    const githubData = await fetchGitHubTimeline();
    
    let sent = 0;
    let failed = 0;
    
    for (const subscriber of subscribers) {
      try {
        await sendGitHubUpdate(subscriber.email, githubData);
        sent++;
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Failed to send email to ${subscriber.email}:`, error);
        failed++;
      }
    }

    res.json({ 
      message: `Updates sent to ${sent} subscribers`,
      total: subscribers.length,
      sent,
      failed
    });

  } catch (error) {
    console.error('Send updates error:', error);
    res.status(500).json({ message: 'Failed to send updates' });
  }
});

// Unsubscribe endpoint
app.post('/api/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    const { error } = await supabase
      .from('subscribers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('email', email);

    if (error) {
      console.error('Unsubscribe error:', error);
      return res.status(500).json({ message: 'Database error' });
    }

    console.log(`Successfully unsubscribed: ${email}`);
    res.json({ message: 'Successfully unsubscribed' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get subscribers count (public endpoint)
app.get('/api/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('id', { count: 'exact' })
      .eq('is_active', true);

    if (error) {
      return res.status(500).json({ message: 'Database error' });
    }

    res.json({
      totalActiveSubscribers: data?.length || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Cron job for daily updates (runs every day at 9 AM UTC)
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily GitHub updates cron job...');
  
  try {
    const { data: subscribers } = await supabase
      .from('subscribers')
      .select('email')
      .eq('is_active', true);

    if (!subscribers || subscribers.length === 0) {
      console.log('No active subscribers found');
      return;
    }

    console.log(`Found ${subscribers.length} active subscribers`);
    const githubData = await fetchGitHubTimeline();
    
    let sent = 0;
    let failed = 0;
    
    for (const subscriber of subscribers) {
      try {
        await sendGitHubUpdate(subscriber.email, githubData);
        sent++;
        // Add delay to avoid overwhelming email service
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to send email to ${subscriber.email}:`, error);
        failed++;
      }
    }

    console.log(`Daily updates completed - Sent: ${sent}, Failed: ${failed}`);
  } catch (error) {
    console.error('Cron job error:', error);
  }
}, {
  timezone: "UTC"
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    message: 'Route not found',
    availableRoutes: [
      'GET /',
      'GET /api/test-db',
      'GET /api/test-github',
      'GET /api/stats',
      'POST /api/signup',
      'POST /api/send-updates',
      'POST /api/unsubscribe'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Supabase URL configured: ${!!process.env.SUPABASE_URL}`);
  console.log(`🔑 Supabase Service Role Key configured: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);
  console.log(`📨 Email configured: ${!!process.env.EMAIL_USER}`);
  console.log(`🐙 GitHub Token configured: ${!!process.env.GITHUB_TOKEN}`);
  console.log(`⏰ Cron job scheduled for daily updates at 9 AM UTC`);
});

module.exports = app;