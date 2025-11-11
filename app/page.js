import Chatbot from '../components/Chatbot';

export default function Home() {
  const config = {
    typingSpeedMs: 15, // milliseconds per character (lower is faster)
    webhook: {
      route: 'general',
    },
    branding: {
      logo: '/logo.svg', // Optional: add your logo URL
      name: 'Spanmor.au',
      welcomeText: 'Hi 👋, How can we help?',
      responseTimeText: 'We typically respond right away',
    },
    style: {
      primaryColor: '#854fff',
      secondaryColor: '#6b3fd4',
      position: 'right', // or 'left'
      backgroundColor: '#ffffff',
      fontColor: '#333333',
    },
  };

  return (
    <main>
      <Chatbot config={config} />
    </main>
  );
}
