import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Abstract Background Animation */}
      <div className="absolute inset-0 flex items-center justify-center opacity-30">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="w-96 h-96 bg-primary/20 rounded-full blur-3xl absolute -left-20"
        />
        <motion.div 
          animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="w-96 h-96 bg-secondary/20 rounded-full blur-3xl absolute -right-20"
        />
      </div>

      <div className="z-10 text-center max-w-2xl px-6">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-6xl md:text-7xl font-bold tracking-tight mb-6"
        >
          AARZOO
        </motion.h1>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="space-y-2 mb-12 text-xl md:text-2xl font-light text-gray-300"
        >
          <p>One moment.</p>
          <p>Two places.</p>
        </motion.div>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-gray-400 mb-12"
        >
          Stay close, even when you're far apart.
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9 }}
          onClick={() => navigate('/create')}
          className="px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full backdrop-blur-md transition-all text-white font-medium hover:scale-105 active:scale-95"
        >
          Create an Aarzoo
        </motion.button>
      </div>
    </div>
  );
}
