import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Copy, Share2, CheckCircle2 } from 'lucide-react';

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Call our backend API to create a session
    fetch('http://localhost:3001/api/sessions', {
      method: 'POST',
    })
      .then(res => res.json())
      .then(data => {
        if (data.sessionId) {
          setSessionId(data.sessionId);
          setLoading(false);
        } else {
          setError('Failed to create session');
        }
      })
      .catch(err => {
        console.error(err);
        setError('Network error. Is the server running?');
        setLoading(false);
      });
  }, []);

  const inviteLink = sessionId ? `${window.location.origin}/join/${sessionId}` : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Aarzoo',
          text: "I've created a private space for us. Join me here:",
          url: inviteLink
        });
      } catch (err) {
        console.error('Error sharing', err);
      }
    } else {
      handleCopy();
    }
  };

  // Poll session status to auto-navigate when the other person joins
  useEffect(() => {
    if (!sessionId) return;
    
    const interval = setInterval(() => {
      fetch(`http://localhost:3001/api/sessions/${sessionId}`)
        .then(res => res.json())
        .then(data => {
          // Since the creator hasn't joined the WS yet, the participant count will be 1 when the invitee joins.
          if (data.status === 'CONNECTED' || data.participantCount >= 1) {
            navigate(`/room/${sessionId}`, { state: { displayName: 'Creator' } });
          }
        })
        .catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative">
      <div className="z-10 w-full max-w-md p-8 bg-surface/50 border border-white/10 rounded-2xl backdrop-blur-xl text-center">
        {loading ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400">Creating your Aarzoo...</p>
          </div>
        ) : error ? (
          <div className="text-red-400">
            <p>{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 text-sm underline hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center"
          >
            <h2 className="text-2xl font-medium mb-2 text-rose-100">Your Aarzoo is ready ❤️</h2>
            <p className="text-gray-400 mb-8 text-sm">Share this link with your person.</p>
            
            <div className="w-full bg-black/40 rounded-lg p-3 flex items-center justify-between border border-white/5 mb-6">
              <span className="text-sm truncate text-gray-300 mr-4 font-mono">{inviteLink}</span>
              <button 
                onClick={handleCopy}
                className="text-gray-400 hover:text-white transition-colors"
                title="Copy link"
              >
                {copied ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex space-x-4 w-full mb-8">
              <button 
                onClick={handleShare}
                className="flex-1 flex items-center justify-center space-x-2 bg-primary/20 hover:bg-primary/30 text-primary-100 py-3 rounded-xl transition-colors border border-primary/30"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Link</span>
              </button>
            </div>

            <div className="flex items-center space-x-3 text-gray-500">
              <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
              <p className="text-sm">Waiting for your person...</p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
