import { createRoot } from 'react-dom/client';
import { EmailActionPage } from './components/auth/EmailActionPage';
import './index.css';
import { FormFeedbackProvider } from './components/common/FormFeedback';

createRoot(document.getElementById('root')!).render(<FormFeedbackProvider><EmailActionPage /></FormFeedbackProvider>);
