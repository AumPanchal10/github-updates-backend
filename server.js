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
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('subscribers')
      .select('email')
      .eq('email', email)
      .single();

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
      return res.status(500).json({ message: 'Database error' });
    }

    // Fetch GitHub data and send welcome email
    try {
      const githubData = await fetchGitHubTimeline();
      await sendGitHubUpdate(email, githubData);
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
    res.status(500).json({ message: 'Internal server error' });
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
});

module.exports = app;