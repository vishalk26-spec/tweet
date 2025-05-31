'use client';

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@clerk/nextjs";
import { saveChatToS3, getChatFromS3, listUserChats, ChatData } from "@/utils/s3";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Chat {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

type Tone = 'None' | 'Funny' | 'Professional' | 'Inspirational' | 'Witty';
type Goal = 'None' | 'Engagement' | 'Informative' | 'Promotion';
type Audience = 'None' | 'Tech' | 'Marketing' | 'Founders' | 'General';

export default function Dashboard() {
  const { userId } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tone, setTone] = useState<Tone>('None');
  const [goal, setGoal] = useState<Goal>('None');
  const [audience, setAudience] = useState<Audience>('None');
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load user's chats from S3
  useEffect(() => {
    if (userId) {
      loadUserChats();
    }
  }, [userId]);

  const loadUserChats = async () => {
    if (!userId) return;

    try {
      const chatIds = await listUserChats(userId);
      const loadedChats: Chat[] = [];

      for (const chatId of chatIds) {
        const chatData = await getChatFromS3(userId, chatId);
        if (chatData) {
          loadedChats.push({
            id: chatData.id,
            messages: chatData.messages,
            createdAt: new Date(chatData.createdAt),
            updatedAt: new Date(chatData.updatedAt),
          });
        }
      }

      setChats(loadedChats);
      if (loadedChats.length > 0) {
        setCurrentChatId(loadedChats[0].id);
      } else {
        createNewChat();
      }
    } catch (error) {
      console.error('Error loading chats:', error);
      createNewChat();
    }
  };

  // Initialize with a new chat if none exists
  useEffect(() => {
    if (chats.length === 0) {
      createNewChat();
    }
  }, []);

  // Update messages when current chat changes
  useEffect(() => {
    const currentChat = chats.find(chat => chat.id === currentChatId);
    if (currentChat) {
      setMessages(currentChat.messages);
    }
  }, [currentChatId, chats]);

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setChats(prev => [...prev, newChat]);
    setCurrentChatId(newChat.id);
    setMessages([]);
    setInput('');
    setCurrentStreamingMessage('');

    // Save new chat to S3
    if (userId) {
      saveChatToS3(userId, newChat.id, {
        ...newChat,
        createdAt: newChat.createdAt.toISOString(),
        updatedAt: newChat.updatedAt.toISOString(),
      });
    }
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamingMessage]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const saveChat = async (chatId: string, updatedMessages: Message[]) => {
    if (!userId) return;

    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    const updatedChat: Chat = {
      ...chat,
      messages: updatedMessages,
      updatedAt: new Date(),
    };

    // Update local state
    setChats(prev => prev.map(c => 
      c.id === chatId ? updatedChat : c
    ));

    // Save to S3
    try {
      await saveChatToS3(userId, chatId, {
        ...updatedChat,
        createdAt: updatedChat.createdAt.toISOString(),
        updatedAt: updatedChat.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error('Error saving chat:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message to chat
    const userMessage: Message = { role: 'user', content: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);
    setCurrentStreamingMessage('');

    // Save updated messages
    await saveChat(currentChatId, updatedMessages);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: input,
          tone: tone === 'None' ? null : tone,
          goal: goal === 'None' ? null : goal,
          audience: audience === 'None' ? null : audience,
          conversationHistory: messages.slice(-4) // Keep last 4 messages for context
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedMessage = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        accumulatedMessage += text;
        setCurrentStreamingMessage(accumulatedMessage);
      }

      // Add the complete message to the chat
      const assistantMessage: Message = { role: 'assistant', content: accumulatedMessage };
      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);
      setCurrentStreamingMessage('');

      // Save final messages
      await saveChat(currentChatId, finalMessages);
    } catch (error) {
      console.error('Error:', error);
      // Add error message to chat
      const errorMessage: Message = { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      };
      const errorMessages = [...updatedMessages, errorMessage];
      setMessages(errorMessages);
      
      // Save error state
      await saveChat(currentChatId, errorMessages);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <motion.div 
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.5 }}
        className="w-64 bg-zinc-900 border-r border-zinc-800 p-4 flex flex-col"
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={createNewChat}
          className="bg-white text-black px-4 py-2 rounded-lg mb-4 font-medium hover:bg-zinc-200 transition-colors"
        >
          New Chat
        </motion.button>
        
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <AnimatePresence>
            {chats.map((chat) => (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors ${
                  chat.id === currentChatId 
                    ? 'bg-zinc-800' 
                    : 'hover:bg-zinc-800/50'
                }`}
                onClick={() => setCurrentChatId(chat.id)}
              >
                <div className="text-sm truncate">
                  {chat.messages[0]?.content || 'New Chat'}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {new Date(chat.updatedAt).toLocaleDateString()}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 p-4">
        <div className="max-w-4xl mx-auto">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-4xl font-bold mb-8 text-center text-white"
          >
            Idea Bird Chat
          </motion.h1>
          
          {/* Chat Messages */}
          <div className="bg-zinc-900 rounded-lg shadow-lg p-4 mb-4 h-[60vh] overflow-y-auto border border-zinc-800 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <AnimatePresence>
              {messages.map((message, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  className={`mb-4 ${
                    message.role === 'user' ? 'text-right' : 'text-left'
                  }`}
                >
                  <motion.div
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={`inline-block p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-white text-black'
                        : 'bg-zinc-800 text-white'
                    }`}
                  >
                    {message.content}
                  </motion.div>
                </motion.div>
              ))}
            </AnimatePresence>
            {currentStreamingMessage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-4 text-left"
              >
                <motion.div
                  initial={{ scale: 0.95 }}
                  animate={{ scale: 1 }}
                  className="inline-block p-3 rounded-lg bg-zinc-800 text-white"
                >
                  {currentStreamingMessage}
                </motion.div>
              </motion.div>
            )}
            {isLoading && !currentStreamingMessage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center text-zinc-400"
              >
                Thinking...
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Dropdowns */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4"
          >
            <div>
              <label className="block text-sm font-medium mb-2">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
                className="w-full p-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-white text-white"
              >
                <option value="None">None</option>
                <option value="Funny">Funny</option>
                <option value="Professional">Professional</option>
                <option value="Inspirational">Inspirational</option>
                <option value="Witty">Witty</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Goal</label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as Goal)}
                className="w-full p-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-white text-white"
              >
                <option value="None">None</option>
                <option value="Engagement">Engagement</option>
                <option value="Informative">Informative</option>
                <option value="Promotion">Promotion</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Audience</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as Audience)}
                className="w-full p-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-white text-white"
              >
                <option value="None">None</option>
                <option value="Tech">Tech</option>
                <option value="Marketing">Marketing</option>
                <option value="Founders">Founders</option>
                <option value="General">General</option>
              </select>
            </div>
          </motion.div>

          {/* Message Input Form */}
          <motion.form 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            onSubmit={handleSubmit} 
            className="flex gap-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to tweet about / Generate a new Idea with AI"
              className="flex-1 p-2 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-white text-white placeholder-zinc-500 resize-none min-h-[40px] max-h-[200px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              rows={1}
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={isLoading}
              className="bg-white text-black px-6 py-2 rounded-lg hover:bg-zinc-200 disabled:bg-zinc-600 disabled:text-zinc-400 transition-colors self-end"
            >
              Generate Tweet
            </motion.button>
          </motion.form>
        </div>
      </div>
    </div>
  );
}
