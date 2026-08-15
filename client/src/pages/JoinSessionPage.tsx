import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

import { API_URL } from '../config';

export default function JoinSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setJoining(true);
    
    // Check if session exists/full before navigating
    fetch(`${API_URL}/sessions/${sessionId}`)
      .then(res => {
        if (!res.ok) throw new Error('Session unavailable');
        return res.json();
      })
      .then(data => {
        if (data.participantCount >= 2) {
          alert('This Aarzoo is already occupied.');
          navigate('/');
        } else {
          // Pass the display name in state when navigating to the room
          navigate(`/room/${sessionId}`, { state: { displayName: name.trim() } });
        }
      })
      .catch(err => {
        console.error(err);
        alert('This Aarzoo has ended or does not exist.');
        navigate('/');
      })
      .finally(() => {
        setJoining(false);
      });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative">
      <div className="z-10 w-full max-w-md p-8 bg-surface/80 border border-white/10 rounded-2xl backdrop-blur-xl text-center shadow-2xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-xl font-light text-gray-300 mb-2">You've been invited to Aarzoo.</h2>
          <div className="text-3xl font-serif text-white/90 mb-8 italic">One moment.<br/>Two places.</div>
          
          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                What's your name?
              </label>
              <input 
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-center text-white focus:outline-none focus:border-primary/50 transition-colors"
                autoFocus
                maxLength={20}
                required
              />
            </div>
            
            <button 
              type="submit"
              disabled={!name.trim() || joining}
              className="w-full bg-primary hover:bg-rose-600 disabled:opacity-50 disabled:hover:bg-primary text-white rounded-xl py-3 font-medium transition-all"
            >
              {joining ? 'Joining...' : 'Join Aarzoo ❤️'}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
