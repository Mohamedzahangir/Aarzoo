import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
      <div className="z-10 text-center max-w-2xl p-10 md:p-16 rounded-[2.5rem] mx-6">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-6xl md:text-7xl font-serif font-bold tracking-tight mb-6 text-white drop-shadow-lg"
        >
          AARZOO
        </motion.h1>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="space-y-2 mb-10 text-xl md:text-2xl font-light text-white/90 drop-shadow-md"
        >
          <p>One moment.</p>
          <p>Two places.</p>
        </motion.div>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-white/80 mb-12 drop-shadow"
        >
          Stay close, even when you're far apart.
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9 }}
          onClick={() => navigate('/create')}
          className="px-10 py-4 glass-button w-full sm:w-auto mx-auto font-medium shadow-lg hover:scale-105 active:scale-95"
        >
          Create an Aarzoo
        </motion.button>
      </div>
    </div>
  );
}
