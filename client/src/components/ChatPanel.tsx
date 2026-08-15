import { useState, useEffect, useRef } from 'react';

interface ChatMessage {
  id: string;
  participantId: string;
  text: string;
  timestamp: number;
}

interface ChatPanelProps {
  ws: WebSocket | null;
  sessionId: string | undefined;
  participantId: string;
}

export function ChatPanel({ ws, sessionId, participantId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === 'CHAT_MESSAGE') {
        setMessages(prev => [...prev, data.message]);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !ws || !sessionId) return;

    const message: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      participantId,
      text: inputText,
      timestamp: Date.now()
    };

    ws.send(JSON.stringify({
      type: 'CHAT_MESSAGE',
      sessionId,
      participantId,
      message
    }));

    setMessages(prev => [...prev, message]);
    setInputText('');
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-gray-500 py-10">
            <p className="text-sm">Messages disappear when this Aarzoo ends.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.participantId === participantId;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe ? 'bg-primary text-white rounded-br-none' : 'bg-white/10 text-white rounded-bl-none'}`}>
                  <p className="text-sm">{msg.text}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-white/10 bg-surface">
        <form onSubmit={sendMessage}>
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Send a temporary message..."
            className="w-full bg-black/50 border border-white/10 rounded-full px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
          />
        </form>
      </div>
    </div>
  );
}
