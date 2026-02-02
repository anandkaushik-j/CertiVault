
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Camera, 
  FileText, 
  Trash2, 
  ChevronLeft, 
  Loader2, 
  Share2, 
  Upload, 
  X, 
  Check, 
  CheckCircle,
  ChevronRight as ChevronRightIcon,
  Home,
  CheckSquare,
  Search,
  Eraser,
  Plus,
  AlertCircle,
  Sparkles,
  ChevronDown,
  Folder,
  Square,
  RotateCcw,
  RotateCw,
  Cloud,
  LogOut,
  User as UserIcon,
  CloudUpload,
  ExternalLink,
  Settings
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

// --- Configuration ---
// Ensure this ID is configured as a "Web application" in Google Cloud Console
// with the correct "Authorized JavaScript origins" whitelisted.
const GOOGLE_CLIENT_ID = "257110771108-9u5pelqmi4krcsomp6buor1pvlqijerb.apps.googleusercontent.com";
const STORAGE_KEY = 'certivault_pro_v18_final_fix'; 
const BASE_CATEGORIES = ['Academics', 'Sports', 'Arts', 'Competitions', 'Workshops', 'Other'];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'Academics': 'Recognition for academic excellence, scholarly performance, and high grades.',
  'Sports': 'Commendation for athletic participation, teamwork, sportsmanship, and physical competition.',
  'Arts': 'Celebration of creativity, artistic expression, and skill in music, fine arts, or performances.',
  'Competitions': 'Award for outstanding performance and merit in organized contests and competitive events.',
  'Workshops': 'Acknowledgment of skill development, participation, and completion of educational seminars.',
  'Other': 'General recognition for various accomplishments and special activities.'
};

// --- Types ---
interface Profile {
  id: string;
  name: string;
}

interface Certificate {
  id: string;
  image: string; 
  profileId: string;
  studentName: string; 
  title: string;
  issuer: string;
  date: string; 
  category: string;
  summary: string; 
  createdAt: number;
  synced?: boolean;
}

interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

// --- Helper Functions ---
const getAcademicYear = (dateStr: string) => {
  if (!dateStr) return "Unknown Year";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Unknown Year";
  const year = date.getFullYear();
  const month = date.getMonth(); 
  return (month >= 3) ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const resizeImage = (base64Str: string, maxWidth = 1400, maxHeight = 1400): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
  });
};

const rotateImage = (base64: string, degrees: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(base64);
      const angle = (degrees * Math.PI) / 180;
      const is90Step = degrees % 180 !== 0;
      canvas.width = is90Step ? img.height : img.width;
      canvas.height = is90Step ? img.width : img.height;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(angle);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
  });
};

const pdfToImage = async (file: File): Promise<string> => {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF Library Missing");
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 }); 
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height; canvas.width = viewport.width;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
};

const CertiVault = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [view, setView] = useState<'dashboard' | 'scanner' | 'editor' | 'detail'>('dashboard');
  const [navPath, setNavPath] = useState<{year?: string, category?: string}>({});
  
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);
  const [pendingCert, setPendingCert] = useState<Partial<Certificate> | null>(null);
  const [isAddingCustomCategory, setIsAddingCustomCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Google Integration State
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoriesList = useMemo(() => {
    return Array.from(new Set([...BASE_CATEGORIES, ...customCategories]));
  }, [customCategories]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.profiles) setProfiles(data.profiles);
        if (data.activeProfileId) setActiveProfileId(data.activeProfileId);
        if (data.certificates) setCertificates(data.certificates);
        if (data.customCategories) setCustomCategories(data.customCategories);
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, certificates, activeProfileId, customCategories }));
  }, [profiles, certificates, activeProfileId, customCategories]);

  // --- Google Integration Logic ---
  const handleGoogleLogin = () => {
    try {
      if (!(window as any).google) {
        setError("Google SDK not loaded. Please check your internet connection.");
        return;
      }

      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: (tokenResponse: any) => {
          if (tokenResponse.error) {
            console.error("Auth Error:", tokenResponse);
            setError(`Authentication Error: ${tokenResponse.error_description || tokenResponse.error}`);
            setShowConfigHelp(true);
            return;
          }
          if (tokenResponse.access_token) {
            setAccessToken(tokenResponse.access_token);
            fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
            })
            .then(res => res.json())
            .then(data => {
              setGoogleUser({ name: data.name, email: data.email, picture: data.picture });
              setError(null);
              setShowConfigHelp(false);
            })
            .catch(() => setError("Failed to retrieve user profile."));
          }
        },
      });
      client.requestAccessToken();
    } catch (err: any) {
      setError("Initialization Error. Ensure your Client ID and Domain are correctly configured.");
      setShowConfigHelp(true);
    }
  };

  const driveApi = async (endpoint: string, options: RequestInit = {}) => {
    if (!accessToken) throw new Error("Not signed in");
    const response = await fetch(`https://www.googleapis.com/drive/v3/${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      }
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "Drive API failed");
    }
    return response.json();
  };

  const findOrCreateFolder = async (name: string, parentId?: string) => {
    const query = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${parentId ? `and '${parentId}' in parents` : ""}`;
    const list = await driveApi(`files?q=${encodeURIComponent(query)}&fields=files(id)`);
    if (list.files && list.files.length > 0) return list.files[0].id;

    const folder = await driveApi('files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : []
      })
    });
    return folder.id;
  };

  const uploadFileToDrive = async (cert: Certificate, folderId: string, pdfBlob: Blob) => {
    const metadata = {
      name: `${cert.title.replace(/\s+/g, '_')}.pdf`,
      parents: [folderId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', pdfBlob);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    });
    
    if (!response.ok) throw new Error("Upload failed");
    return response.json();
  };

  const syncToDrive = async () => {
    if (!accessToken) return handleGoogleLogin();
    const profile = profiles.find(p => p.id === activeProfileId);
    if (!profile) return setError("No active profile selected.");

    setIsProcessing(true);
    setProcessStatus("Mirroring Vault to Cloud...");
    try {
      const rootId = await findOrCreateFolder("CertiVault");
      const profileId = await findOrCreateFolder(profile.name, rootId);

      const profileCerts = certificates.filter(c => c.profileId === activeProfileId && !c.synced);
      if (profileCerts.length === 0) {
        setProcessStatus("Vault already in sync!");
        await new Promise(r => setTimeout(r, 1000));
        return;
      }

      for (const cert of profileCerts) {
        setProcessStatus(`Vaulting: ${cert.title}...`);
        const year = getAcademicYear(cert.date);
        const yearId = await findOrCreateFolder(year, profileId);
        const catId = await findOrCreateFolder(cert.category, yearId);
        
        const blob = await generatePDFBlob([cert]);
        await uploadFileToDrive(cert, catId, blob);
        
        setCertificates(prev => prev.map(c => c.id === cert.id ? { ...c, synced: true } : c));
      }
      setProcessStatus("Sync Successful!");
      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      setError(`Sync failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Document Logic (Professional Academic PDF) ---
  const generatePDFBlob = async (certs: Certificate[]) => {
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210, pageHeight = 297, margin = 20;
    const contentWidth = pageWidth - (margin * 2);

    for (let i = 0; i < certs.length; i++) {
      if (i > 0) doc.addPage();
      const cert = certs[i];
      
      const img = new Image();
      img.src = cert.image;
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = () => { console.error("Img Load Failed"); resolve(null); };
      });

      // Header: Academic Report Header
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(15, 23, 42).text(cert.title, margin, 20);
      doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(71, 85, 105).text(`OFFICIAL REPOSITORY RECORD • ISSUED BY: ${cert.issuer.toUpperCase()}`, margin, 28);
      
      // Document Display
      const startY = 50;
      const maxImgH = 150; 
      let fW = contentWidth;
      let fH = (img.naturalHeight * fW) / img.naturalWidth;
      
      if (fH > maxImgH) {
        fH = maxImgH;
        fW = (img.naturalWidth * fH) / img.naturalHeight;
      }
      
      const xOffset = margin + (contentWidth - fW) / 2;
      
      // Shadow Effect for document
      doc.setFillColor(241, 245, 249);
      doc.rect(xOffset + 1, startY + 1, fW, fH, 'F');
      doc.addImage(cert.image, 'JPEG', xOffset, startY, fW, fH);

      // Metadata Section
      let y = startY + fH + 18;
      doc.setDrawColor(226, 232, 240).setLineWidth(0.4).line(margin, y - 10, pageWidth - margin, y - 10);
      
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(15, 23, 42).text("ACHIEVEMENT CLASSIFICATION", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(71, 85, 105).text(`${cert.category}: ${CATEGORY_DESCRIPTIONS[cert.category] || "Special achievement recognition."}`, margin, y);
      
      y += 14;
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(15, 23, 42).text("EXECUTIVE SUMMARY", margin, y);
      y += 6;
      const lines = doc.splitTextToSize(cert.summary || "This record acknowledges the successful participation and achievements of the recipient as documented in the attached scan.", contentWidth);
      doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(71, 85, 105).text(lines, margin, y);

      // Footer
      doc.setDrawColor(241, 245, 249).line(margin, pageHeight - 20, pageWidth - margin, pageHeight - 20);
      doc.setFontSize(8).setFont("helvetica", "normal").setTextColor(148, 163, 184).text(`Vaulted via CertiVault Pro • Secure Digital Repository • ${new Date().toLocaleDateString()}`, margin, pageHeight - 12);
      doc.text(`Page ${i + 1} of ${certs.length}`, pageWidth - margin - 15, pageHeight - 12);
    }
    return doc.output('blob');
  };

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setView('scanner');
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch (err) { setError("Camera access denied. Please verify your browser permissions."); }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);
    stopCamera();
    processCertificate(await resizeImage(base64Image));
  };

  const processCertificate = async (base64Data: string) => {
    setIsProcessing(true);
    setProcessStatus('AI Analysis & Extraction...');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const rectificationResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: base64Data.split(',')[1], mimeType: 'image/jpeg' } },
            { text: "Transform this certificate scan into a clean, flat, high-quality A4 document. Remove all background noise and perspective distortion." }
          ]
        }
      });
      const imgPart = rectificationResponse.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      const cleaned = imgPart ? `data:image/png;base64,${imgPart.inlineData.data}` : base64Data;

      const metadataResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { 
          parts: [{ inlineData: { data: cleaned.split(',')[1], mimeType: 'image/jpeg' } }, { text: "Return metadata as JSON: {title, studentName, issuer, date, category, summary}" }]
        },
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(metadataResponse.text);
      setPendingCert({
        id: Date.now().toString(), image: cleaned, profileId: activeProfileId,
        studentName: data.studentName || "", title: data.title || "Record Scan",
        issuer: data.issuer || "", date: data.date || new Date().toISOString().split('T')[0],
        category: categoriesList.includes(data.category) ? data.category : 'Other', 
        summary: data.summary || "", createdAt: Date.now()
      });
      setView('editor');
    } catch (err: any) {
      setError("AI Analysis failed. Please enter details manually.");
      setPendingCert({ id: Date.now().toString(), image: base64Data, profileId: activeProfileId, title: "Record Scan", date: new Date().toISOString().split('T')[0], category: 'Other', createdAt: Date.now() });
      setView('editor');
    } finally { setIsProcessing(false); }
  };

  const filteredCerts = useMemo(() => certificates.filter(c => c.profileId === activeProfileId), [certificates, activeProfileId]);
  const sortedYears = useMemo(() => Array.from(new Set(filteredCerts.map(c => getAcademicYear(c.date)))).sort().reverse(), [filteredCerts]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 overflow-x-hidden">
      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-white/95 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in">
          <div className="relative">
             <Loader2 className="w-16 h-16 text-indigo-600 animate-spin mb-6" />
             <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-indigo-400 animate-pulse" />
          </div>
          <h2 className="text-2xl font-black tracking-tight">{processStatus}</h2>
          <p className="text-slate-400 font-bold text-sm mt-2">Optimizing for professional standards...</p>
        </div>
      )}

      {error && (
        <div className="fixed top-4 left-4 right-4 z-[300] p-5 bg-slate-900 text-white rounded-[2rem] shadow-2xl animate-in slide-in-from-top-4">
          <div className="flex justify-between items-start">
             <div className="flex items-start gap-4">
               <div className="p-2 bg-red-500 rounded-xl mt-0.5"><AlertCircle className="w-5 h-5 text-white" /></div>
               <div>
                 <span className="text-sm font-black uppercase tracking-widest text-red-400 block mb-1">Error Detected</span>
                 <p className="text-sm font-bold text-slate-200 leading-relaxed">{error}</p>
                 {showConfigHelp && (
                   <button 
                    onClick={() => setShowConfigHelp(!showConfigHelp)} 
                    className="mt-3 text-xs font-black text-indigo-400 flex items-center gap-2 hover:text-indigo-300"
                   >
                     <Settings className="w-4 h-4" /> View Configuration Guide
                   </button>
                 )}
               </div>
             </div>
             <button onClick={() => setError(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X className="w-5 h-5" /></button>
          </div>
          
          {showConfigHelp && (
            <div className="mt-6 pt-6 border-t border-white/10 space-y-4 animate-in slide-in-from-top-2">
               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">How to fix the 400 error:</p>
               <ol className="text-xs font-medium text-slate-300 space-y-3 list-decimal pl-4">
                 <li>Go to your <a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-indigo-400 underline">Google Cloud Console</a>.</li>
                 <li>Select your OAuth Client ID and edit it.</li>
                 <li>Add <code className="bg-white/10 px-2 py-0.5 rounded text-white">{window.location.origin}</code> to **Authorized JavaScript origins**.</li>
                 <li>Wait 5 minutes and try again.</li>
               </ol>
            </div>
          )}
        </div>
      )}

      {view === 'dashboard' && (
        <div className="max-w-5xl mx-auto p-4 md:p-10 pb-32">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-12">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-600 rounded-[1.25rem] text-white shadow-xl shadow-indigo-200"><FileText className="w-7 h-7" /></div>
              <div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tighter">CertiVault</h1>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Digital Achievement Repository</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 w-full sm:w-auto">
              {googleUser ? (
                <div className="flex items-center gap-3 bg-white pl-1.5 pr-5 py-1.5 rounded-full border border-slate-200 shadow-sm transition-all hover:shadow-md">
                  <img src={googleUser.picture} className="w-9 h-9 rounded-full border-2 border-slate-50 shadow-inner" />
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-slate-800 leading-none mb-1">{googleUser.name.split(' ')[0]}</span>
                    <button onClick={() => { setGoogleUser(null); setAccessToken(null); }} className="text-[10px] font-black text-red-400 uppercase tracking-widest text-left hover:text-red-500">Sign Out</button>
                  </div>
                </div>
              ) : (
                <button onClick={handleGoogleLogin} className="flex-1 sm:flex-none flex items-center justify-center gap-3 px-6 py-3.5 bg-white text-indigo-600 border border-indigo-100 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-sm">
                  <UserIcon className="w-5 h-5" /> Sign In
                </button>
              )}
              
              <div className="flex-1 sm:flex-none relative flex items-center bg-white px-5 py-3.5 rounded-2xl border border-slate-200 shadow-sm group hover:border-indigo-300 transition-colors">
                  <select value={activeProfileId} onChange={(e) => setActiveProfileId(e.target.value)} className="font-black text-slate-800 text-sm outline-none appearance-none pr-6 bg-transparent cursor-pointer w-full">
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    {profiles.length === 0 && <option value="" disabled>No Profiles</option>}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-4 pointer-events-none group-hover:text-indigo-500" />
              </div>
              <button onClick={() => setIsAddingProfile(true)} className="p-4 bg-indigo-600 text-white rounded-2xl shadow-xl shadow-indigo-100 hover:scale-105 transition-transform"><Plus className="w-6 h-6" /></button>
            </div>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
            <button onClick={startCamera} className="group relative overflow-hidden py-8 bg-slate-900 text-white rounded-[2.5rem] font-black flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-[0.98] transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <Camera className="w-8 h-8 group-hover:scale-110 transition-transform" /> 
              <span className="text-sm uppercase tracking-widest">Digital Scan</span>
            </button>
            <button onClick={syncToDrive} className="group relative overflow-hidden py-8 bg-indigo-600 text-white rounded-[2.5rem] font-black flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-[0.98] transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CloudUpload className="w-8 h-8 group-hover:scale-110 transition-transform" /> 
              <span className="text-sm uppercase tracking-widest">{accessToken ? "Sync Cloud Vault" : "Connect Drive"}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-8">
            {!navPath.year ? sortedYears.map(ay => (
              <button key={ay} onClick={() => setNavPath({ year: ay })} className="flex flex-col items-center gap-5 p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all group">
                <div className="relative">
                   <Folder className="w-20 h-20 text-indigo-400 fill-indigo-50 group-hover:text-indigo-500 group-hover:fill-indigo-100 transition-all" />
                   <div className="absolute inset-0 flex items-center justify-center mt-2">
                     <span className="text-[10px] font-black text-indigo-700 bg-white px-2 py-0.5 rounded shadow-sm">{ay.split('-')[1].slice(-2)}</span>
                   </div>
                </div>
                <div className="text-center">
                  <span className="font-black text-slate-800 text-lg tracking-tight">{ay}</span>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {filteredCerts.filter(c => getAcademicYear(c.date) === ay).length} Items
                  </p>
                </div>
              </button>
            )) : !navPath.category ? Array.from(new Set(filteredCerts.filter(c => getAcademicYear(c.date) === navPath.year).map(c => c.category))).map(cat => (
              <button key={cat} onClick={() => setNavPath({ ...navPath, category: cat })} className="flex flex-col items-center gap-5 p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all group">
                <Folder className="w-20 h-20 text-slate-300 fill-slate-50 group-hover:text-indigo-400 group-hover:fill-indigo-50 transition-all" />
                <div className="text-center">
                  <span className="font-black text-slate-800 text-lg tracking-tight">{cat}</span>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {filteredCerts.filter(c => getAcademicYear(c.date) === navPath.year && c.category === cat).length} Files
                  </p>
                </div>
              </button>
            )) : filteredCerts.filter(c => getAcademicYear(c.date) === navPath.year && c.category === navPath.category).map(cert => (
              <div key={cert.id} onClick={() => { setSelectedCert(cert); setView('detail'); }} className="group bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden hover:shadow-2xl transition-all cursor-pointer relative">
                <div className="aspect-[1.414/1] bg-slate-50 p-4 flex items-center justify-center overflow-hidden">
                  <img src={cert.image} className="max-h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                  {cert.synced && <div className="absolute top-4 right-4 p-2 bg-green-500/90 backdrop-blur-sm text-white rounded-full shadow-lg"><Check className="w-3 h-3" /></div>}
                </div>
                <div className="p-6">
                  <h3 className="text-sm font-black truncate text-slate-900 mb-1">{cert.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate flex-1">{cert.issuer}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {navPath.year && (
             <button onClick={() => setNavPath({})} className="fixed bottom-10 left-1/2 -translate-x-1/2 px-10 py-5 bg-slate-900 text-white rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-2xl flex items-center gap-3 hover:bg-slate-800 transition-all active:scale-95 animate-in slide-in-from-bottom-6"><ChevronLeft className="w-5 h-5" /> All Academic Years</button>
          )}
        </div>
      )}

      {view === 'scanner' && (
        <div className="fixed inset-0 bg-black z-[150] flex flex-col">
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <button onClick={() => { stopCamera(); setView('dashboard'); }} className="absolute top-8 left-8 p-5 bg-white/10 backdrop-blur-xl rounded-[1.5rem] text-white hover:bg-white/20 transition-all">
              <ChevronLeft className="w-7 h-7" />
            </button>
            
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm aspect-[1.414/1] border-2 border-white/50 rounded-[2rem] pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]">
              <div className="absolute inset-0 bg-indigo-500/5 rounded-[2rem] animate-pulse" />
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-indigo-500 rounded-tl-[1.5rem]" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-indigo-500 rounded-tr-[1.5rem]" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-indigo-500 rounded-bl-[1.5rem]" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-indigo-500 rounded-br-[1.5rem]" />
            </div>
          </div>
          <div className="bg-black p-16 flex flex-col items-center gap-6">
            <button onClick={capturePhoto} className="w-24 h-24 rounded-full border-[6px] border-white/20 p-2 transition-transform active:scale-90 bg-transparent flex items-center justify-center group">
              <div className="w-full h-full bg-white rounded-full shadow-[0_0_40px_rgba(255,255,255,0.3)] group-hover:scale-95 transition-transform" />
            </button>
            <p className="text-white/40 font-black text-[10px] uppercase tracking-[0.3em]">Center document in frame</p>
          </div>
        </div>
      )}

      {view === 'editor' && pendingCert && (
        <div className="fixed inset-0 z-[150] bg-white flex flex-col animate-in slide-in-from-bottom duration-500">
          <header className="p-6 border-b border-slate-100 flex justify-between items-center">
            <button onClick={() => setView('dashboard')} className="p-3 hover:bg-slate-50 rounded-2xl transition-colors"><ChevronLeft className="w-6 h-6 text-slate-400" /></button>
            <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-500" /> Professional Review</h2>
            <button onClick={() => { if(!pendingCert.title) return; setCertificates(p => [{ ...pendingCert, synced: false } as Certificate, ...p]); setView('dashboard'); }} className="text-indigo-600 font-black uppercase text-xs tracking-widest px-4 py-2 hover:bg-indigo-50 rounded-xl transition-colors">Vault</button>
          </header>
          
          <div className="flex-1 overflow-y-auto p-6 lg:p-12 space-y-12 pb-40">
            <div className="relative aspect-[1.414/1] max-w-3xl mx-auto w-full bg-slate-100 rounded-[3rem] flex items-center justify-center p-8 shadow-inner border border-slate-200/50">
               <img src={pendingCert.image} className="max-h-full object-contain rounded-[0.5rem] shadow-2xl" />
               <div className="absolute bottom-8 right-8 flex gap-3">
                 <button onClick={async () => setPendingCert({ ...pendingCert, image: await rotateImage(pendingCert.image!, -90) })} className="p-4 bg-slate-900/90 backdrop-blur-xl text-white rounded-[1.25rem] hover:bg-slate-900 shadow-2xl transition-all active:scale-95"><RotateCcw className="w-6 h-6" /></button>
                 <button onClick={async () => setPendingCert({ ...pendingCert, image: await rotateImage(pendingCert.image!, 90) })} className="p-4 bg-slate-900/90 backdrop-blur-xl text-white rounded-[1.25rem] hover:bg-slate-900 shadow-2xl transition-all active:scale-95"><RotateCw className="w-6 h-6" /></button>
               </div>
            </div>

            <div className="max-w-2xl mx-auto space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Achievement Title</label>
                <input type="text" value={pendingCert.title} onChange={e => setPendingCert({ ...pendingCert, title: e.target.value })} className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-black text-lg outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all" />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Issuer / Institution</label>
                  <input type="text" value={pendingCert.issuer} onChange={e => setPendingCert({ ...pendingCert, issuer: e.target.value })} className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Classification</label>
                  <div className="relative">
                    <select value={pendingCert.category} onChange={e => setPendingCert({ ...pendingCert, category: e.target.value })} className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none appearance-none cursor-pointer">
                      {categoriesList.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Student Name</label>
                  <input type="text" value={pendingCert.studentName} onChange={e => setPendingCert({ ...pendingCert, studentName: e.target.value })} className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Official Award Date</label>
                  <input type="date" value={pendingCert.date} onChange={e => setPendingCert({ ...pendingCert, date: e.target.value })} className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Professional Summary</label>
                <textarea value={pendingCert.summary} onChange={e => setPendingCert({ ...pendingCert, summary: e.target.value })} className="w-full p-6 bg-slate-50 border border-slate-100 rounded-[2rem] text-sm h-40 resize-none outline-none focus:ring-2 focus:ring-indigo-100 leading-relaxed font-medium" placeholder="Describe the achievement context..." />
              </div>
            </div>
          </div>
          
          <div className="p-8 bg-white border-t border-slate-100 flex justify-center">
             <button 
              onClick={() => { if(!pendingCert.title) return; setCertificates(p => [{ ...pendingCert, synced: false } as Certificate, ...p]); setView('dashboard'); }} 
              className="w-full max-w-2xl py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-[0.98]"
             >
               Finalize & Vault Achievement
             </button>
          </div>
        </div>
      )}

      {view === 'detail' && selectedCert && (
        <div className="fixed inset-0 z-[150] bg-white flex flex-col p-6 lg:p-12 overflow-y-auto animate-in fade-in duration-500">
          <div className="flex justify-between items-center mb-12">
            <button onClick={() => setView('dashboard')} className="p-4 hover:bg-slate-50 rounded-2xl transition-colors"><ChevronLeft className="w-7 h-7 text-slate-400" /></button>
            <div className="flex gap-4">
               <button onClick={async () => {
                 setIsProcessing(true);
                 setProcessStatus("Generating Document...");
                 try {
                   const blob = await generatePDFBlob([selectedCert]);
                   const url = URL.createObjectURL(blob);
                   const a = document.createElement('a');
                   a.href = url;
                   a.download = `${selectedCert.title.replace(/\s+/g, '_')}_Record.pdf`;
                   a.click();
                 } catch(e) { setError("PDF export failed."); }
                 setIsProcessing(false);
               }} className="text-indigo-600 font-black text-xs uppercase tracking-widest bg-indigo-50 px-6 py-3 rounded-2xl flex items-center gap-3 hover:bg-indigo-100 transition-all"><Share2 className="w-5 h-5" /> Export PDF</button>
               <button onClick={() => { if(confirm("Permanently remove this record?")) { setCertificates(p => p.filter(c => c.id !== selectedCert.id)); setView('dashboard'); } }} className="text-red-500 font-black text-xs uppercase tracking-widest bg-red-50 px-6 py-3 rounded-2xl flex items-center gap-3 hover:bg-red-100 transition-all"><Trash2 className="w-5 h-5" /> Delete</button>
            </div>
          </div>
          
          <div className="max-w-4xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-start pb-20">
            <div className="aspect-[1.414/1] w-full bg-slate-50 rounded-[3rem] shadow-2xl flex items-center justify-center p-8 border border-slate-100">
              <img src={selectedCert.image} className="max-h-full object-contain rounded-lg" />
            </div>
            
            <div className="space-y-10">
              <div className="space-y-4">
                 <h2 className="text-4xl font-black text-slate-900 leading-tight tracking-tight">{selectedCert.title}</h2>
                 <div className="flex flex-wrap gap-3">
                    <span className="bg-slate-900 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">{selectedCert.issuer}</span>
                    <span className="bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">{getAcademicYear(selectedCert.date)}</span>
                    <span className="bg-slate-100 text-slate-500 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">{selectedCert.category}</span>
                 </div>
              </div>
              
              <div className="grid grid-cols-2 gap-10">
                 <div className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recipient</span>
                    <p className="font-bold text-slate-800 text-lg">{selectedCert.studentName || "N/A"}</p>
                 </div>
                 <div className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Awarded</span>
                    <p className="font-bold text-slate-800 text-lg">{new Date(selectedCert.date).toLocaleDateString()}</p>
                 </div>
              </div>

              <div className="space-y-4">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Official Record Description</span>
                 <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 text-slate-600 font-medium leading-relaxed italic">
                   "{selectedCert.summary || "This record serves as digital proof of achievement as documented in the institution's archive."}"
                 </div>
              </div>

              <div className="flex items-center gap-4 p-6 bg-indigo-600 text-white rounded-[2rem] shadow-xl">
                 <div className="p-3 bg-white/20 rounded-2xl"><ExternalLink className="w-5 h-5" /></div>
                 <div className="flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Google Drive Path</p>
                    <p className="text-xs font-bold truncate">/CertiVault/{profiles.find(p => p.id === activeProfileId)?.name}/{getAcademicYear(selectedCert.date)}/{selectedCert.category}</p>
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddingProfile && (
        <div className="fixed inset-0 z-[250] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl w-full max-w-sm space-y-8 animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-slate-900">Add Unique Profile</h3>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Initialize a separate achievement vault</p>
            </div>
            <input autoFocus type="text" value={newProfileName} onChange={e => setNewProfileName(e.target.value)} placeholder="Recipient Full Name" className="w-full p-6 bg-slate-50 rounded-2xl font-black outline-none border-2 border-transparent focus:border-indigo-500/20 focus:bg-white transition-all text-center" />
            <div className="flex gap-4">
              <button onClick={() => setIsAddingProfile(false)} className="flex-1 py-5 text-slate-400 font-black text-xs uppercase tracking-widest">Cancel</button>
              <button onClick={() => { if(newProfileName.trim()) { const n = { id: Date.now().toString(), name: newProfileName.trim() }; setProfiles(p => [...p, n]); setActiveProfileId(n.id); setNewProfileName(''); setIsAddingProfile(false); } }} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700">Initialize</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<CertiVault />);
