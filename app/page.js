import Chatbot from '../components/Chatbot';

export default function Home() {
  const config = {
    webhook: {
      url: 'https://atd-test.app.n8n.cloud/webhook/4d40cbf6-128f-4647-90f2-df59ad6c7dab/chat',
      route: 'general',
    },
    branding: {
      logo: '', // Optional: add your logo URL
      name: 'Spanmor.au',
      welcomeText: 'Hi 👋, how can we help?',
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
