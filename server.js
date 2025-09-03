// server.js - Main Express server
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
    'http://localhost:3000',                    // For local development
    'https://github-updates-frontend.vercel.app',   // Remove trailing slash
    'https://github-updates-frontend.vercel.app/', // Keep this for compatibility
  ],
  credentials: true
}));
app.use(express.json());

// Supabase client - IMPORTANT: Use SERVICE_ROLE key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Changed from SUPABASE_KEY to SUPABASE_SERVICE_ROLE_KEY
);

// Email transporter (using Gmail as example)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS // Use app password for Gmail
  }
});

// Fetch GitHub timeline data
async function fetchGitHubTimeline() {
  try {
    const response = await fetch('https://api.github.com/events/public?per_page=10');
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    const events = await response.json();
    return events;
  } catch (error) {
    console.error('Error fetching GitHub timeline:', error);
    throw error;
  }
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
    const action = eventTypes[event.type] || 'activity in';
    const actor = event.actor.login;
    const repo = event.repo.name;
    const time = new Date(event.created_at).toLocaleString();
    
    return `• ${actor} ${action} ${repo} at ${time}`;
  }).join('\n');

  return `Here are the latest GitHub activities:\n\n${formattedEvents}`;
}

// Send email with GitHub updates
async function sendGitHubUpdate(email, githubData) {
  const emailContent = formatGitHubEvents(githubData);
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your Daily GitHub Updates',
    text: emailContent,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">GitHub Updates</h2>
        <p>Here are the latest activities from the GitHub community:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
          ${emailContent.replace(/\n/g, '<br>')}
        </div>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          You're receiving this because you subscribed to GitHub updates.
        </p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'GitHub Updates API is running!' });
});

// Test Supabase connection
app.get('/api/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers')
      .select('count(*)')
      .limit(1);
    
    if (error) {
      console.error('Database test error:', error);
      return res.status(500).json({ error: 'Database connection failed', details: error });
    }
    
    res.json({ message: 'Database connection successful', data });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ error: 'Database test failed', details: error.message });
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

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 means no rows returned
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
    res.status(500).json({ message: 'Internal server error', details: error.message });
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
    for (const subscriber of subscribers) {
      try {
        await sendGitHubUpdate(subscriber.email, githubData);
        sent++;
      } catch (error) {
        console.error(`Failed to send email to ${subscriber.email}:`, error);
      }
    }

    res.json({ 
      message: `Updates sent to ${sent} subscribers`,
      total: subscribers.length
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
    
    const { error } = await supabase
      .from('subscribers')
      .update({ is_active: false })
      .eq('email', email);

    if (error) {
      return res.status(500).json({ message: 'Database error' });
    }

    res.json({ message: 'Successfully unsubscribed' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Cron job for daily updates (runs every day at 9 AM)
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

    const githubData = await fetchGitHubTimeline();
    
    let sent = 0;
    for (const subscriber of subscribers) {
      try {
        await sendGitHubUpdate(subscriber.email, githubData);
        sent++;
        // Add small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send email to ${subscriber.email}:`, error);
      }
    }

    console.log(`Daily updates sent to ${sent} subscribers`);
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Supabase URL configured: ${!!process.env.SUPABASE_URL}`);
  console.log(`Supabase Service Role Key configured: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);
});

module.exports = app;