
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Camera, 
  FileText, 
  Plus, 
  Download, 
  Cloud, 
  Trash2, 
  Maximize2, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  Share2, 
  Upload, 
  User as UserIcon, 
  ChevronDown, 
  Folder, 
  Calendar, 
  X, 
  Check, 
  UserPlus, 
  Layers,
  FolderOpen,
  ChevronRight as ChevronRightIcon,
  Home,
  CheckSquare,
  Square,
  Search,
  Tag as TagIcon,
  Filter,
  Hash,
  CloudUpload,
  Server,
  LogOut,
  Shield,
  Zap,
  Smartphone,
  Info,
  Building,
  GraduationCap,
  Sparkles,
  Eraser,
  MoreHorizontal
} from 'lucide-react';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// --- Configuration & Constants ---
const STORAGE_KEY = 'certivault_pro_v4_tags_search'; 
const USER_SESSION_KEY = 'certivault_user_session';
const BASE_CATEGORIES = ['Competitions', 'Academics', 'Sports', 'Arts', 'Workshops', 'Volunteering', 'Other'];

/**
 * FIXED SCOPES: Using fully qualified URLs for all scopes. 
 * Combining Identity and Drive access requires explicit full URLs to satisfy modern Google OAuth policies.
 */
const DRIVE_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
].join(' ');

// UPDATE THESE FOR PRODUCTION
const FAMILY_WHITELIST = ['subhavya.anand@example.com', 'admin@example.com', 'anandkaushik@gmail.com']; 
const GOOGLE_CLIENT_ID = "257110771108-9u5pelqmi4krcsomp6buor1pvlqijerb.apps.googleusercontent.com"; 

// --- Types ---
interface Profile {
  id: string;
  name: string;
}

interface Certificate {
  id: string;
  image: string; 
  originalImage?: string; 
  profileId: string;
  studentName: string;
  title: string;
  issuer: string;
  date: string; 
  category: string;
  subject: string;
  summary: string;
  tags: string[]; 
  createdAt: number;
  synced: boolean;
}

interface User {
  name: string;
  firstName: string;
  initials: string;
  email: string;
  picture: string;
  accessToken?: string;
}

interface SyncLog {
  id: string;
  message: string;
  status: 'pending' | 'success' | 'info';
}

// Initialize PDF.js worker
if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
  (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// --- Helper Functions ---
const getAcademicYear = (dateStr: string) => {
  if (!dateStr) return "Unknown Year";
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth(); 
  if (month >= 6) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

const resizeImage = (base64Str: string, maxWidth = 1600, maxHeight = 1600): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.90));
    };
  });
};

const pdfToImage = async (file: File): Promise<string> => {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF.js not loaded");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 }); 
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
};

// --- Drive API Helpers ---
const escapeQuery = (str: string) => str.replace(/'/g, "\\'");

async function findOrCreateFolder(name: string, parentId?: string, accessToken?: string) {
  if (!accessToken) throw new Error("No access token");
  const escapedName = escapeQuery(name);
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false ${parentId ? `and '${parentId}' in parents` : "and 'root' in parents"}`;
  
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id, name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!response.ok) throw new Error(`Drive Search Error: ${response.statusText}`);
  const data = await response.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    })
  });
  
  if (!createResponse.ok) throw new Error(`Folder Creation Error: ${createResponse.statusText}`);
  const folder = await createResponse.json();
  return folder.id;
}

async function uploadFileToDrive(blob: Blob, name: string, parentId: string, accessToken: string) {
  const metadata = {
    name,
    parents: [parentId],
    mimeType: 'application/pdf'
  };

  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelimiter = "\r\n--" + boundary + "--";

  const parts = [
    delimiter,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    delimiter,
    'Content-Type: application/pdf\r\n\r\n',
    blob,
    closeDelimiter
  ];

  const requestBody = new Blob(parts, { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: requestBody
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Upload Failed: ${errorData.error?.message || response.statusText}`);
  }
  
  return await response.json();
}

// --- App Component ---
const CertiVault = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [view, setView] = useState<'dashboard' | 'scanner' | 'editor' | 'detail'>('dashboard');
  const [navPath, setNavPath] = useState<{year?: string, category?: string}>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);
  const [pendingCert, setPendingCert] = useState<Partial<Certificate> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isSharing, setIsSharing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [editorNewProfileName, setEditorNewProfileName] = useState('');
  const [isAddingCustomCategory, setIsAddingCustomCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [tagInput, setTagInput] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tokenClientRef = useRef<any>(null);

  const categoriesList = [...BASE_CATEGORIES, ...customCategories];

  useEffect(() => {
    const savedUser = localStorage.getItem(USER_SESSION_KEY);
    if (savedUser) setUser(JSON.parse(savedUser));

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.profiles) setProfiles(data.profiles);
        if (data.certificates) setCertificates(data.certificates);
        if (data.activeProfileId) setActiveProfileId(data.activeProfileId);
        if (data.customCategories) setCustomCategories(data.customCategories);
      } catch (e) { console.error("Parse failed", e); }
    }

    const initGsi = () => {
      if (typeof (window as any).google !== 'undefined') {
        try {
          tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: async (tokenResponse: any) => {
              if (tokenResponse.error) {
                setError("Google login failed: " + tokenResponse.error_description || tokenResponse.error);
                setIsLoggingIn(false);
                return;
              }
              try {
                const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
                });
                const info = await userInfoResp.json();
                
                if (FAMILY_WHITELIST.length > 0 && !FAMILY_WHITELIST.includes(info.email)) {
                  setError(`Access restricted. ${info.email} is not in the family whitelist.`);
                  setIsLoggingIn(false);
                  return;
                }

                const userData: User = {
                  name: info.name,
                  firstName: info.given_name || info.name.split(' ')[0],
                  initials: (info.name[0] + (info.family_name ? info.family_name[0] : '')).toUpperCase(),
                  email: info.email,
                  picture: info.picture,
                  accessToken: tokenResponse.access_token
                };
                setUser(userData);
                localStorage.setItem(USER_SESSION_KEY, JSON.stringify(userData));
              } catch (err) {
                setError("Logged in but failed to fetch profile info. Ensure 'userinfo.email' scope is allowed.");
              } finally {
                setIsLoggingIn(false);
              }
            }
          });
        } catch (err) {
          console.error("GSI Init Error", err);
        }
      } else {
        setTimeout(initGsi, 500); 
      }
    };
    initGsi();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profiles, certificates, activeProfileId, customCategories
    }));
  }, [profiles, certificates, activeProfileId, customCategories]);

  const handleLogin = () => {
    setIsLoggingIn(true);
    setError(null);
    if (tokenClientRef.current) {
      // Prompt select_account is the most reliable way to clear stale login errors
      tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
    } else {
      setError("Google identity client not ready. If this persists, check your Client ID or network.");
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem(USER_SESSION_KEY);
    setView('dashboard');
    goToRoot();
  };

  const goToRoot = () => setNavPath({});
  const goToYear = (year: string) => setNavPath({ year });
  const goToCategory = (category: string) => setNavPath(prev => ({ ...prev, category }));

  const handleCreateProfile = (name: string = newProfileName) => {
    if (name.trim()) {
      const newProfile = { id: Date.now().toString(), name: name.trim() };
      setProfiles(prev => [...prev, newProfile]);
      setActiveProfileId(newProfile.id);
      setNewProfileName('');
      setEditorNewProfileName('');
      setIsAddingProfile(false);
      goToRoot();
      return newProfile.id;
    }
    return null;
  };

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setView('scanner');
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (err) { setError("Camera access denied."); }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      let imageData = '';
      if (file.type === 'application/pdf') imageData = await pdfToImage(file);
      else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((res) => {
          reader.onload = (ev) => res(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        imageData = await resizeImage(base64);
      } else throw new Error("Unsupported file type.");
      await processCertificate(imageData);
    } catch (err: any) { setError(err.message || "Upload failed"); setIsProcessing(false); }
    e.target.value = '';
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const base64 = c.toDataURL('image/jpeg', 0.85);
    stopCamera();
    processCertificate(await resizeImage(base64));
  };

  const processCertificate = async (base64Data: string) => {
    setIsProcessing(true);
    setView('dashboard'); 
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `You are an elite AI document imaging specialist. Scale to A4 size. Restore & clean high fidelity. OCR extract JSON: {title, studentName, issuer, date (YYYY-MM-DD), category, subject, summary, suggestedTags}.`;
      const pureBase64 = base64Data.split(',')[1] || base64Data;
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ inlineData: { data: pureBase64, mimeType: 'image/jpeg' } }, { text: prompt }] }
      });
      let extractedData: any = {};
      let cleaned = base64Data; 
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) cleaned = `data:image/png;base64,${part.inlineData.data}`;
          else if (part.text) {
            const match = part.text.match(/\{[\s\S]*\}/);
            if (match) extractedData = JSON.parse(match[0]);
          }
        }
      }
      setPendingCert({
        id: Date.now().toString(), image: cleaned, originalImage: base64Data, profileId: activeProfileId,
        studentName: extractedData.studentName || "", title: extractedData.title || "Scan",
        issuer: extractedData.issuer || "", date: extractedData.date || new Date().toISOString().split('T')[0],
        category: categoriesList.includes(extractedData.category) ? extractedData.category : 'Other',
        summary: extractedData.summary || "", tags: extractedData.suggestedTags || [],
        createdAt: Date.now(), synced: false
      });
      setView('editor');
    } catch (err) {
      setError("AI processing failed. Manual entry enabled.");
      setPendingCert({
        id: Date.now().toString(), image: base64Data, originalImage: base64Data, profileId: activeProfileId,
        studentName: "", title: "Manual Entry", issuer: "", date: new Date().toISOString().split('T')[0],
        category: 'Other', summary: "", tags: [], createdAt: Date.now(), synced: false
      });
      setView('editor');
    } finally { setIsProcessing(false); }
  };

  const saveCertificate = () => {
    if (pendingCert) {
      let pId = pendingCert.profileId || activeProfileId;
      if (!pId && editorNewProfileName.trim()) pId = handleCreateProfile(editorNewProfileName) || '';
      if (!pId) { setError("Please select/create a profile."); return; }
      setCertificates(prev => [{ ...pendingCert, profileId: pId, tags: pendingCert.tags || [] } as Certificate, ...prev]);
      setPendingCert(null);
      setView('dashboard');
    }
  };

  const generatePDFBlob = async (certs: Certificate[]): Promise<Blob> => {
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    for (let i = 0; i < certs.length; i++) {
      const c = certs[i];
      if (i > 0) doc.addPage();
      doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(30, 41, 59).text(c.title, 20, 25);
      doc.setFontSize(14).setTextColor(100, 116, 139).text(c.issuer, 20, 33);
      doc.addImage(c.image, 'JPEG', 20, 45, 170, 120);
      doc.setFontSize(10).setTextColor(148, 163, 184).text("AWARDED TO", 20, 175).text("DATE", 105, 175);
      doc.setFontSize(12).setTextColor(51, 65, 85).text(c.studentName || "N/A", 20, 182).text(c.date || "N/A", 105, 182);
      doc.setFontSize(10).setTextColor(148, 163, 184).text("DESCRIPTION", 20, 195);
      doc.setFont("helvetica", "italic").setFontSize(11).setTextColor(71, 85, 105).text(doc.splitTextToSize(c.summary || "", 170), 20, 202);
    }
    return doc.output('blob');
  };

  const syncToDrive = async () => {
    const profile = profiles.find(p => p.id === activeProfileId);
    if (!profile || !user?.accessToken) { setError("Login with Google to sync."); return; }
    setIsSyncing(true); setSyncLogs([]);
    const log = (msg: string, st: 'pending'|'success'|'info'='pending') => setSyncLogs(p => [...p, { id: Math.random().toString(), message: msg, status: st }]);
    try {
      log(`Starting Real Sync for ${profile.name}`, 'info');
      const rootId = await findOrCreateFolder('CertiVault', undefined, user.accessToken);
      const profileFolderId = await findOrCreateFolder(profile.name, rootId, user.accessToken);
      const toSync = certificates.filter(c => c.profileId === activeProfileId && !c.synced);
      if (toSync.length === 0) { log("Everything is synced.", 'success'); return; }
      for (const item of toSync) {
        const year = getAcademicYear(item.date);
        const yearId = await findOrCreateFolder(year, profileFolderId, user.accessToken);
        const catId = await findOrCreateFolder(item.category, yearId, user.accessToken);
        log(`Uploading ${item.title}...`, 'pending');
        const blob = await generatePDFBlob([item]);
        await uploadFileToDrive(blob, `${item.title}.pdf`, catId, user.accessToken);
        setCertificates(p => p.map(c => c.id === item.id ? { ...c, synced: true } : c));
        log(`Synced ${item.title} to /${year}/${item.category}`, 'success');
      }
      log("Sync Complete!", 'success');
    } catch (e: any) { 
      log(`Sync Error: ${e.message}`, 'info'); 
      setError(`Sync Error: ${e.message}`);
    }
    finally { setTimeout(() => setIsSyncing(false), 2000); }
  };

  const filteredCerts = useMemo(() => {
    let res = certificates.filter(c => c.profileId === activeProfileId);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      res = res.filter(c => c.title.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q) || c.tags.some(t => t.toLowerCase().includes(q)));
    }
    if (selectedFilterTags.length > 0) res = res.filter(c => selectedFilterTags.some(t => t === getAcademicYear(c.date) || t === c.category || c.tags.includes(t)));
    return res;
  }, [certificates, activeProfileId, searchQuery, selectedFilterTags]);

  const academicHierarchy = useMemo(() => {
    const h: Record<string, Record<string, Certificate[]>> = {};
    filteredCerts.forEach(c => {
      const ay = getAcademicYear(c.date), cat = c.category || 'Other';
      if (!h[ay]) h[ay] = {}; if (!h[ay][cat]) h[ay][cat] = [];
      h[ay][cat].push(c);
    });
    return h;
  }, [filteredCerts]);

  const sortedAcademicYears = Object.keys(academicHierarchy).sort((a, b) => b.localeCompare(a));

  const renderLogin = () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 bg-gradient-to-br from-indigo-950 via-slate-950 to-black">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div className="text-white space-y-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-indigo-600 rounded-3xl shadow-2xl"><FileText className="w-10 h-10" /></div>
            <h1 className="text-5xl font-black tracking-tighter">CertiVault</h1>
          </div>
          <h2 className="text-3xl font-bold opacity-90">Securely Scan, Organize, and Synchronize achievements.</h2>
          <div className="space-y-4 opacity-70">
            <div className="flex items-center gap-3"><Shield className="w-5 h-5" /> Google Drive Integration</div>
            <div className="flex items-center gap-3"><Zap className="w-5 h-5" /> Gemini AI Document Vision</div>
          </div>
        </div>
        <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl space-y-8 text-center">
          <h3 className="text-3xl font-black text-slate-900">Sign In</h3>
          <p className="text-slate-500 font-medium">Use your Google Account to access the family vault.</p>
          <button onClick={handleLogin} disabled={isLoggingIn} className="w-full py-5 px-6 border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-4 hover:bg-slate-50 transition-all active:scale-95 font-black text-slate-700 shadow-sm">
            {isLoggingIn ? <Loader2 className="w-6 h-6 animate-spin text-indigo-600" /> : <><img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-6 h-6" /> Sign in with Google</>}
          </button>
          <div className="pt-4"><a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-[10px] text-indigo-500 underline font-bold">Billing & API Key Documentation</a></div>
          <p className="text-[10px] text-slate-400">Documents are processed using Google Gemini. Your data stays in your personal Google Drive.</p>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="max-w-6xl mx-auto p-6 md:p-12 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-600 rounded-xl text-white"><FileText className="w-6 h-6" /></div>
          <div><h1 className="text-2xl font-black text-slate-900">CertiVault</h1><p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Academic Repository</p></div>
        </div>
        <div className="flex gap-4">
          <div className="bg-white rounded-full shadow-sm border border-slate-100 h-12 px-5 flex items-center gap-3">
            <select value={activeProfileId} onChange={(e) => { setActiveProfileId(e.target.value); goToRoot(); }} className="bg-transparent font-bold text-slate-700 outline-none text-sm appearance-none pr-4">
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={() => setIsAddingProfile(true)} className="text-slate-300 hover:text-indigo-600"><Plus className="w-5 h-5" /></button>
          </div>
          <div className="bg-white h-12 px-4 rounded-full shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold">{user?.initials}</div>
            <button onClick={handleLogout} className="p-2 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded-full"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-4 mb-10">
        <button onClick={startCamera} className="flex-1 py-4 px-6 bg-slate-900 text-white rounded-2xl hover:bg-indigo-600 transition-all shadow-xl font-bold flex items-center justify-center gap-3"><Camera className="w-6 h-6" /> Scan Document</button>
        <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-4 px-6 bg-white text-slate-700 border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all shadow-sm font-bold flex items-center justify-center gap-3"><Upload className="w-6 h-6" /> Upload File</button>
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,application/pdf" className="hidden" />
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm mb-12">
        <div className="flex flex-col lg:flex-row items-center gap-4">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search archives..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-14 pr-14 py-5 bg-slate-50 rounded-2xl border-none outline-none font-bold text-slate-800" />
          </div>
          <button onClick={syncToDrive} className="flex items-center gap-3 px-8 py-5 bg-indigo-50 text-indigo-600 rounded-2xl font-black hover:bg-indigo-100 w-full lg:w-auto"><CloudUpload className="w-6 h-6" /> Sync to Google Drive</button>
        </div>
      </div>

      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-2 text-sm font-black text-slate-400">
           <button onClick={goToRoot} className={`hover:text-indigo-600 ${!navPath.year ? 'text-indigo-600' : ''}`}>Archives</button>
           {navPath.year && <><ChevronRightIcon className="w-4 h-4" /><button onClick={() => setNavPath({year: navPath.year})} className={!navPath.category ? 'text-indigo-600' : ''}>{navPath.year}</button></>}
           {navPath.category && <><ChevronRightIcon className="w-4 h-4" /><span className="text-indigo-600">{navPath.category}</span></>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {!navPath.year ? (
          sortedAcademicYears.map(ay => (
            <button key={ay} onClick={() => goToYear(ay)} className="group p-6 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all flex flex-col items-center gap-4">
              <Folder className="w-16 h-16 text-indigo-400 fill-indigo-50" />
              <div className="text-center font-black text-slate-800">{ay}</div>
            </button>
          ))
        ) : !navPath.category ? (
          Object.keys(academicHierarchy[navPath.year] || {}).map(cat => (
            <button key={cat} onClick={() => goToCategory(cat)} className="group p-6 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all flex flex-col items-center gap-4">
              <Folder className="w-16 h-16 text-slate-300 fill-slate-50" />
              <div className="text-center font-black text-slate-800">{cat}</div>
            </button>
          ))
        ) : (
          (academicHierarchy[navPath.year!]?.[navPath.category!] || []).map(cert => (
            <div key={cert.id} onClick={() => { setSelectedCert(cert); setView('detail'); }} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden hover:-translate-y-1 transition-all cursor-pointer">
              <div className="aspect-[1.41/1] p-4 bg-slate-50 flex items-center justify-center"><img src={cert.image} className="max-h-full max-w-full object-contain" /></div>
              <div className="p-4"><h3 className="text-sm font-black text-slate-900 truncate">{cert.title}</h3><p className="text-[10px] text-slate-400 truncate">{cert.issuer}</p></div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FDFEFE]">
      {!user ? renderLogin() : (
        <>
          {(isProcessing || isSharing || isSyncing) && (
            <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center text-white p-10 text-center">
              {isSyncing ? (
                <div className="w-full max-w-lg bg-white/5 border border-white/10 p-8 rounded-[3rem]">
                  <Cloud className="w-20 h-20 text-indigo-400 animate-pulse mx-auto mb-6" />
                  <h2 className="text-3xl font-black mb-6">Drive Sync Active</h2>
                  <div className="space-y-3 text-left h-48 overflow-y-auto no-scrollbar">
                    {syncLogs.map(l => (
                      <div key={l.id} className="flex items-center gap-3 text-sm font-bold opacity-80 animate-in slide-in-from-left-4">
                        {l.status === 'success' ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Loader2 className="w-4 h-4 animate-spin" />} {l.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Loader2 className="w-20 h-20 text-indigo-400 animate-spin mb-8" />
                  <h2 className="text-3xl font-black mb-3">{isSharing ? 'Preparing Export...' : 'AI Processing...'}</h2>
                  <p className="text-slate-400">{isSharing ? 'Compiling PDF file.' : 'Optimizing document for vault storage.'}</p>
                </>
              )}
            </div>
          )}
          {error && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-4 bg-red-600 text-white rounded-2xl shadow-xl flex items-center gap-3 font-bold">{error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button></div>}
          {view === 'dashboard' && renderDashboard()}
          {view === 'scanner' && (
             <div className="fixed inset-0 bg-black z-50 flex flex-col">
               <div className="relative flex-1 flex items-center justify-center">
                 <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                 <button onClick={() => { stopCamera(); setView('dashboard'); }} className="absolute top-6 left-6 p-4 bg-white/20 backdrop-blur-md rounded-2xl text-white"><ChevronLeft className="w-6 h-6" /></button>
               </div>
               <div className="bg-black p-10 flex justify-center"><button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-white/30 p-1"><div className="w-full h-full bg-white rounded-full" /></button></div>
               <canvas ref={canvasRef} className="hidden" />
             </div>
          )}
          {view === 'editor' && pendingCert && (
            <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row animate-in fade-in duration-500">
               <div className="lg:flex-1 p-8 flex flex-col bg-slate-200/50">
                 <div className="relative flex-1 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden flex items-center justify-center p-4">
                   <img src={showOriginal ? pendingCert.originalImage : pendingCert.image} className="max-h-full max-w-full object-contain rounded-xl" />
                   <button onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onTouchStart={() => setShowOriginal(true)} onTouchEnd={() => setShowOriginal(false)} className="absolute bottom-6 right-6 px-6 py-3 bg-slate-900/90 text-white text-xs font-black rounded-2xl">Hold to Compare</button>
                 </div>
               </div>
               <div className="w-full lg:w-[500px] bg-white lg:h-screen overflow-y-auto p-10 space-y-8">
                 <h2 className="text-2xl font-black text-slate-900">Verify Details</h2>
                 <div className="space-y-6">
                   <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Title</label><input type="text" value={pendingCert.title} onChange={e => setPendingCert({...pendingCert, title: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-black outline-none" /></div>
                   <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Issuer</label><input type="text" value={pendingCert.issuer} onChange={e => setPendingCert({...pendingCert, issuer: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-black outline-none" /></div>
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Category</label><select value={pendingCert.category} onChange={e => setPendingCert({...pendingCert, category: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-black outline-none appearance-none">{categoriesList.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                     <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Date</label><input type="date" value={pendingCert.date} onChange={e => setPendingCert({...pendingCert, date: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-black outline-none" /></div>
                   </div>
                   <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase">Summary</label><textarea value={pendingCert.summary} onChange={e => setPendingCert({...pendingCert, summary: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-medium outline-none min-h-[120px] resize-none" /></div>
                 </div>
                 <button onClick={saveCertificate} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl shadow-2xl hover:bg-indigo-600 transition-all">SAVE TO VAULT</button>
               </div>
            </div>
          )}
          {view === 'detail' && selectedCert && (
            <div className="min-h-screen bg-slate-50 flex flex-col">
              <header className="bg-white px-8 py-5 border-b border-slate-100 flex justify-between items-center">
                <button onClick={() => setView('dashboard')} className="flex items-center gap-2 font-bold text-slate-600"><ChevronLeft className="w-5 h-5" /> Back</button>
                <div className="flex gap-3">
                  <button onClick={() => { if(confirm("Delete?")) { setCertificates(p => p.filter(c => c.id !== selectedCert.id)); setView('dashboard'); } }} className="p-3 text-red-400 hover:bg-red-50 rounded-xl"><Trash2 className="w-5 h-5" /></button>
                </div>
              </header>
              <main className="max-w-6xl mx-auto w-full p-8 grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="bg-white p-6 rounded-3xl shadow-xl flex items-center justify-center"><img src={selectedCert.image} className="w-full h-auto rounded-2xl shadow-sm" /></div>
                <div className="bg-white p-10 rounded-3xl shadow-sm space-y-6">
                  <h2 className="text-3xl font-black text-slate-900 leading-tight">{selectedCert.title}</h2>
                  <p className="text-xl text-slate-400 font-bold">{selectedCert.issuer}</p>
                  <div className="p-6 bg-slate-50 rounded-2xl italic text-slate-600">"{selectedCert.summary}"</div>
                  <div className="grid grid-cols-2 gap-4 text-sm font-black uppercase text-slate-400">
                    <div><span className="block text-[10px]">Award Date</span><span className="text-slate-800">{selectedCert.date}</span></div>
                    <div><span className="block text-[10px]">Academic Year</span><span className="text-slate-800">{getAcademicYear(selectedCert.date)}</span></div>
                  </div>
                </div>
              </main>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<CertiVault />);
}
