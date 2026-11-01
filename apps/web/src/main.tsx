import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import Presentation from './pages/Presentation';
import { DemoData } from './data/source';
import Admin, { DemoLogin } from './pages/Admin';
import {
  About, BookPage, CalculatePage, ContactPage, FaqPage, Home, LegalPage, ServiceDetail, Services, TrackPage,
} from './pages/Site';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
const SERVICE_SLUGS = ['domestic', 'express', 'surface', 'bulk'];

function ServiceRoute() {
  const { slug = '' } = useParams();
  return SERVICE_SLUGS.includes(slug) ? <ServiceDetail slug={slug} /> : <Navigate to="/services" replace />;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname, hash]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<DemoData><Presentation /></DemoData>} />
          <Route path="/presentation" element={<DemoData><Presentation /></DemoData>} />
          <Route path="/home" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:slug" element={<ServiceRoute />} />
          <Route path="/calculate" element={<CalculatePage />} />
          <Route path="/book" element={<BookPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/privacy" element={<LegalPage kind="privacy" />} />
          <Route path="/terms" element={<LegalPage kind="terms" />} />
          <Route path="/login" element={<DemoLogin />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/franchise/*" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
