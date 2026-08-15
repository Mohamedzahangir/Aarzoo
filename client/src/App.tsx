import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CreateSessionPage from './pages/CreateSessionPage';
import JoinSessionPage from './pages/JoinSessionPage';
import MainRoom from './pages/MainRoom';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[url('/images/bg-mobile.jpg')] md:bg-[url('/images/bg-tablet.jpg')] lg:bg-[url('/images/bg-laptop.jpg')] bg-[length:100%_100%] bg-center bg-fixed bg-no-repeat text-white font-sans selection:bg-primary/30 relative flex flex-col">
        {/* Global dark overlay */}
        <div className="absolute inset-0 bg-black/40"></div>
        
        {/* Main Content wrapper */}
        <div className="relative z-10 flex-1 flex flex-col w-full">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/create" element={<CreateSessionPage />} />
            <Route path="/join/:sessionId" element={<JoinSessionPage />} />
            <Route path="/room/:sessionId" element={<MainRoom />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
