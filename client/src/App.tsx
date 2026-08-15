import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CreateSessionPage from './pages/CreateSessionPage';
import JoinSessionPage from './pages/JoinSessionPage';
import MainRoom from './pages/MainRoom';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background text-white font-sans selection:bg-primary/30">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/create" element={<CreateSessionPage />} />
          <Route path="/join/:sessionId" element={<JoinSessionPage />} />
          <Route path="/room/:sessionId" element={<MainRoom />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
