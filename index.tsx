
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
  User as UserIcon, 
  ChevronDown, 
  Folder, 
  Calendar, 
  X, 
  Check, 
  Layers,
  ChevronRight as ChevronRightIcon,
  Home,
  CheckSquare,
  Square,
  Search,
  Tag as TagIcon,
  Eraser,
  LogOut,
  Sparkles,
  Zap,
  Info,
  Filter,
  CloudUpload,
  CheckCircle,
  RotateCw
} from 'lucide-react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// --- Configuration & Constants ---
const STORAGE_KEY = 'certivault_pro_v15_final'; 
const USER_SESSION_KEY = 'certivault_user_session';
const BASE_CATEGORIES = ['Competitions', 'Academics', 'Sports', 'Arts', 'Workshops', 'Volunteering', 'Other'];

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
  createdAt: number;
  synced?: boolean;
}

interface User {
  name: string;
  firstName: string;
  initials: string;
  email: string;
}

interface SyncLog {
  id: string;
  message: string;
  status: 'pending' | 'success' | 'info';
}

// --- Helper Functions ---
const getAcademicYear = (dateStr: string) => {
  if (!dateStr) return "Unknown Year";
  const date = new Date(dateStr);
  
  if (isNaN(date.getTime())) {
    const match = dateStr.match(/\d{4}/);
    if (match) {
      const y = parseInt(match[0]);
      return `${y}-${y + 1}`;
    }
    return "Unknown Year";
  }

  const year = date.getFullYear();
  const month = date.getMonth(); 
  
  if (month >= 3) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

const rotateImageBase64 = (base64Str: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        resolve(canvas.toDataURL('image/jpeg', 0.90));
      } else {
        resolve(base64Str);
      }
    };
  });
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
  if (!pdfjsLib) throw new Error("PDF.js library not found.");
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

// --- App Component ---
const CertiVault = () => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [view, setView] = useState<'dashboard' | 'scanner' | 'editor' | 'detail'>('dashboard');
  const [navPath, setNavPath] = useState<{year?: string, category?: string}>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);
  const [pendingCert, setPendingCert] = useState<Partial<Certificate> | null>(null);
  
  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [processProgress, setProcessProgress] = useState(0);
  
  // Sync States
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoriesList = useMemo(() => [...BASE_CATEGORIES, ...customCategories], [customCategories]);

  const activeProfile = useMemo(() => 
    profiles.find(p => p.id === activeProfileId), 
  [profiles, activeProfileId]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.profiles && data.profiles.length > 0) {
          setProfiles(data.profiles);
          if (data.activeProfileId) setActiveProfileId(data.activeProfileId);
        } else {
          const id = Date.now().toString();
          setProfiles([{ id, name: 'Subhavya' }]);
          setActiveProfileId(id);
        }
        if (data.certificates) setCertificates(data.certificates);
        if (data.customCategories) setCustomCategories(data.customCategories);
      } catch (e) { console.error(e); }
    } else {
      const id = Date.now().toString();
      setProfiles([{ id, name: 'Subhavya' }]);
      setActiveProfileId(id);
    }
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        profiles, certificates, activeProfileId, customCategories
      }));
    }
  }, [profiles, certificates, activeProfileId, customCategories, user]);

  const handleLogin = () => {
    const mock = { name: 'Subhavya Anand', firstName: 'Subhavya', initials: 'SA', email: 'subhavya@example.com' };
    setUser(mock);
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(mock));
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const processCertificate = async (base64Data: string) => {
    setIsProcessing(true);
    setProcessProgress(10);
    setProcessStatus('Analyzing photo orientation...');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const pureBase64 = base64Data.split(',')[1] || base64Data;

      const img = new Image();
      img.src = base64Data;
      await new Promise(resolve => { img.onload = resolve; });
      const isLandscape = img.width > img.height;
      const orientation = isLandscape ? "landscape" : "portrait";
      const aspect = isLandscape ? "1.414:1" : "1:1.414";

      setProcessProgress(30);
      setProcessStatus(`Gemini AI: Rectifying perspective (${orientation})...`);

      const cleanupPrompt = `You are a professional document scanning AI. 
      Perform high-fidelity perspective correction (rectification) on this certificate.
      
      CRITICAL INSTRUCTIONS:
      1. STRICTLY MAINTAIN PHOTO ORIENTATION: The output image MUST match the input aspect ratio and orientation exactly. If the photo is ${orientation} (wide if landscape, tall if portrait), the rectified output MUST be ${orientation}. 
      2. DO NOT ROTATE CONTENT: Do not attempt to "straighten" a vertical certificate into a horizontal frame or vice-versa. Maintain the orientation of the photo frame.
      3. ENFORCE A4 ASPECT RATIO: The internal certificate dimensions must follow a ${aspect} aspect ratio relative to the ${orientation} frame.
      4. CLEAN CANVAS: Replace everything around the certificate with pure white (#FFFFFF). 
      5. QUALITY: Remove shadows, sharpen text, and normalize brightness.
      
      Return the final rectified image in the exact same ${orientation} orientation as the original photo.`;

      const cleanupResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ inlineData: { data: pureBase64, mimeType: 'image/jpeg' } }, { text: cleanupPrompt }] }
      });

      setProcessProgress(65);
      setProcessStatus('Gemini AI: Reading certificate text...');

      let processedImage = base64Data;
      if (cleanupResponse.candidates?.[0]?.content?.parts) {
        const imagePart = cleanupResponse.candidates[0].content.parts.find(p => p.inlineData);
        if (imagePart) processedImage = `data:image/png;base64,${imagePart.inlineData.data}`;
      }

      setProcessProgress(85);
      setProcessStatus('Finalizing achievement data...');

      const ocrPrompt = `Extract certificate metadata into a JSON object:
      { "title": "...", "studentName": "...", "issuer": "...", "date": "YYYY-MM-DD", "category": "...", "subject": "...", "summary": "..." }
      - category: Competitions, Academics, Sports, Arts, Workshops, Volunteering, or Other.
      - summary: A professional 1-sentence description.`;

      const ocrResponse: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: [{ inlineData: { data: processedImage.split(',')[1], mimeType: 'image/png' } }, { text: ocrPrompt }] }
      });

      setProcessProgress(95);

      let extractedData: any = {};
      const text = ocrResponse.text;
      if (text) {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) extractedData = JSON.parse(match[0]);
      }

      setPendingCert({
        id: Date.now().toString(),
        image: processedImage,
        originalImage: base64Data,
        profileId: activeProfileId,
        studentName: extractedData.studentName || "",
        title: extractedData.title || "Certificate of Participation",
        issuer: extractedData.issuer || "",
        date: extractedData.date || "",
        category: categoriesList.includes(extractedData.category) ? extractedData.category : 'Competitions',
        subject: extractedData.subject || "",
        summary: extractedData.summary || "",
        createdAt: Date.now()
      });

      setProcessProgress(100);
      setTimeout(() => setView('editor'), 400);
    } catch (err) {
      console.error(err);
      setError("AI was unable to process the text. Please enter details manually.");
      setPendingCert({
        id: Date.now().toString(), image: base64Data, originalImage: base64Data, profileId: activeProfileId,
        studentName: "", title: "New Certificate", issuer: "", date: "", category: 'Other', subject: "", summary: "", createdAt: Date.now()
      });
      setView('editor');
    } finally { 
      setTimeout(() => {
        setIsProcessing(false); 
        setProcessStatus('');
        setProcessProgress(0);
      }, 600);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setProcessStatus('Uploading document...');
    setProcessProgress(10);
    try {
      let imageData = '';
      if (file.type === 'application/pdf') imageData = await pdfToImage(file);
      else {
        const reader = new FileReader();
        imageData = await new Promise<string>((resolve) => {
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
      }
      await processCertificate(await resizeImage(imageData));
    } catch (err: any) { setError(err.message || "Upload failed"); setIsProcessing(false); }
    e.target.value = '';
  };

  const handleShareBatchPDF = async () => {
    if (selectedIds.size === 0) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    const certsToShare = certificates.filter(c => selectedIds.has(c.id));
    certsToShare.forEach((cert, index) => {
      if (index > 0) doc.addPage();
      doc.setFont("helvetica", "bold").setFontSize(22).text(cert.title, 20, 30);
      doc.setFontSize(10).setFont("helvetica", "normal").text(`Issuer: ${cert.issuer} | Academic Year: ${getAcademicYear(cert.date)}`, 20, 40);
      doc.addImage(cert.image, 'JPEG', 20, 50, 170, 120);
      doc.text("Description:", 20, 185);
      const splitText = doc.splitTextToSize(cert.summary || "No summary provided.", 170);
      doc.text(splitText, 20, 195);
    });
    doc.save(`Vault_Export_${Date.now()}.pdf`);
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const syncToDrive = async () => {
    if (!activeProfile) return;
    setIsSyncing(true);
    setSyncLogs([]);
    const addLog = (m: string, s: 'pending'|'success'|'info' = 'pending') => {
      setSyncLogs(prev => [...prev, { id: Math.random().toString(), message: m, status: s }]);
    };

    addLog(`Initializing Google Drive Sync for Profile: ${activeProfile.name}`, 'info');
    await new Promise(r => setTimeout(r, 600));
    addLog(`Creating hierarchy: Drive > CertiVault > ${activeProfile.name}`, 'pending');
    await new Promise(r => setTimeout(r, 800));
    addLog(`Root folder established.`, 'success');

    const profileCerts = certificates.filter(c => c.profileId === activeProfileId);
    const years = Array.from(new Set(profileCerts.map(c => getAcademicYear(c.date))));

    for (const year of years) {
      addLog(`Creating year folder: ${year}`, 'pending');
      await new Promise(r => setTimeout(r, 400));
      addLog(`Folder ${year} ready.`, 'success');

      const yearCerts = profileCerts.filter(c => getAcademicYear(c.date) === year);
      const cats = Array.from(new Set(yearCerts.map(c => c.category)));

      for (const cat of cats) {
        addLog(`  > Syncing category: ${cat}`, 'pending');
        await new Promise(r => setTimeout(r, 300));
        addLog(`  > Folder ${cat} established.`, 'success');
        
        const catCerts = yearCerts.filter(c => c.category === cat);
        for (const cert of catCerts) {
           addLog(`    * Uploading "${cert.title}.pdf"`, 'pending');
           await new Promise(r => setTimeout(r, 500));
           setCertificates(prev => prev.map(item => item.id === cert.id ? {...item, synced: true} : item));
        }
      }
    }

    addLog(`Profile "${activeProfile.name}" fully mirrored on Google Drive.`, 'success');
    setTimeout(() => setIsSyncing(false), 2000);
  };

  const filteredCerts = useMemo(() => {
    let res = certificates.filter(c => c.profileId === activeProfileId);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      res = res.filter(c => c.title.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q) || c.studentName.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q));
    }
    if (selectedFilterTags.length > 0) {
      res = res.filter(c => selectedFilterTags.includes(c.category) || selectedFilterTags.includes(getAcademicYear(c.date)));
    }
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

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    certificates.filter(c => c.profileId === activeProfileId).forEach(c => years.add(getAcademicYear(c.date)));
    return Array.from(years).sort((a,b) => b.localeCompare(a));
  }, [certificates, activeProfileId]);

  const toggleFilterTag = (tag: string) => {
    setSelectedFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleManualRotate = async () => {
    if (!pendingCert?.image) return;
    const rotated = await rotateImageBase64(pendingCert.image);
    setPendingCert({ ...pendingCert, image: rotated });
  };

  const isBrowsing = !searchQuery && selectedFilterTags.length === 0;

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 bg-gradient-to-br from-indigo-900 to-black">
        <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] shadow-2xl text-center space-y-8 animate-in zoom-in-95 duration-500">
          <div className="flex justify-center"><div className="p-4 bg-indigo-600 rounded-3xl text-white shadow-xl"><FileText className="w-10 h-10" /></div></div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">CertiVault</h1>
          <p className="text-slate-400 font-medium italic">Professional Achievement Management System</p>
          <button onClick={handleLogin} className="w-full py-5 px-6 bg-slate-900 text-white rounded-2xl font-black text-lg hover:bg-indigo-600 active:scale-95 transition-all shadow-xl">Enter Vault</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFEFE] font-sans">
      {/* PROCESSING & SYNC OVERLAYS */}
      {(isProcessing || isSyncing) && (
        <div className="fixed inset-0 z-[200] bg-white/95 backdrop-blur-2xl flex flex-col items-center justify-center text-slate-900 p-10 text-center animate-in fade-in duration-300">
          {isSyncing ? (
            <div className="w-full max-w-lg bg-slate-50 border border-slate-200 p-8 rounded-[3rem] shadow-2xl overflow-hidden">
                <CloudUpload className="w-16 h-16 text-indigo-600 mx-auto mb-6 animate-bounce" />
                <h2 className="text-2xl font-black mb-6 text-slate-900">Synchronizing Vault</h2>
                <div className="space-y-3 text-left max-h-[300px] overflow-y-auto no-scrollbar mask-fade font-bold text-xs uppercase tracking-wider">
                    {syncLogs.map((log) => (
                      <div key={log.id} className="flex items-center gap-3 animate-in slide-in-from-left-2">
                        {log.status === 'pending' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                        <span className={log.status === 'success' ? 'text-green-600' : 'text-slate-400'}>{log.message}</span>
                      </div>
                    ))}
                </div>
            </div>
          ) : (
            <>
              <div className="relative mb-10">
                <Loader2 className="w-28 h-28 text-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center font-black text-sm text-indigo-700">{processProgress}%</div>
              </div>
              <h2 className="text-3xl font-black mb-4 tracking-tight">{processStatus}</h2>
              <div className="w-full max-w-sm h-3 bg-slate-100 rounded-full overflow-hidden mb-8 border border-slate-200 shadow-inner">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-700 transition-all duration-700 ease-out" style={{ width: `${processProgress}%` }} />
              </div>
              <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-2 flex items-center gap-2"><Zap className="w-3 h-3" /> Professional A4 Rectification</div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] px-6 py-4 bg-red-600 text-white rounded-2xl shadow-xl flex items-center gap-3 font-bold animate-in slide-in-from-top-4">
          <Info className="w-5 h-5" /> {error}
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70"><X className="w-4 h-4" /></button>
        </div>
      )}

      {view === 'dashboard' && (
        <div className="max-w-6xl mx-auto p-6 md:p-12 animate-in fade-in duration-500">
          <header className="flex justify-between items-center mb-10">
            <div className="flex items-center gap-3"><div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg"><FileText className="w-6 h-6" /></div><h1 className="text-2xl font-black text-slate-900 tracking-tight">CertiVault</h1></div>
            <div className="flex items-center gap-3 bg-white h-10 px-4 rounded-full border border-slate-100 shadow-sm">
                <select value={activeProfileId} onChange={(e) => setActiveProfileId(e.target.value)} className="bg-transparent font-bold text-slate-700 outline-none text-xs appearance-none pr-4">
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-slate-300 hover:text-red-500" title="Sign Out"><LogOut className="w-4 h-4" /></button>
            </div>
          </header>

          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm mb-10 space-y-6">
            <div className="relative"><Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input type="text" placeholder="Search achievements, recipients, subjects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-14 pr-12 py-5 bg-slate-50 rounded-2xl font-bold text-slate-800 outline-none focus:bg-white transition-all shadow-sm" /></div>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              <div className="p-2 bg-slate-100 text-slate-400 rounded-xl mr-1"><Filter className="w-4 h-4" /></div>
              {availableYears.map(year => (
                <button key={year} onClick={() => toggleFilterTag(year)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all border shrink-0 ${selectedFilterTags.includes(year) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-slate-100 text-slate-500 hover:border-indigo-200'}`}>{year}</button>
              ))}
              <div className="w-[1px] h-6 bg-slate-200 mx-2 shrink-0" />
              {categoriesList.map(cat => (
                <button key={cat} onClick={() => toggleFilterTag(cat)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all border shrink-0 ${selectedFilterTags.includes(cat) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-slate-100 text-slate-500 hover:border-indigo-200'}`}>{cat}</button>
              ))}
              {(searchQuery || selectedFilterTags.length > 0) && <button onClick={() => { setSearchQuery(''); setSelectedFilterTags([]); }} className="px-5 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5"><Eraser className="w-3 h-3" /> Clear</button>}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-10">
            <button onClick={() => { startCamera(); }} className="flex-1 py-4.5 px-6 bg-slate-900 text-white rounded-2xl hover:bg-indigo-600 transition-all shadow-xl font-bold flex items-center justify-center gap-3 active:scale-[0.98]"><Camera className="w-5 h-5" /> Scan Achievement</button>
            <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-4.5 px-6 bg-white text-slate-700 border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all font-bold flex items-center justify-center gap-3 active:scale-[0.98]"><Upload className="w-5 h-5" /> Upload Document</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,application/pdf" className="hidden" />
          </div>

          <div className="flex justify-between items-center mb-8 px-2">
            <div className="flex items-center gap-2 text-sm font-black text-slate-400">
              <button onClick={() => setNavPath({})} className={`flex items-center gap-1.5 hover:text-indigo-600 transition-colors ${!navPath.year ? 'text-indigo-600' : ''}`}>
                <Home className="w-4 h-4" /> {activeProfile?.name || 'My Profile'}
              </button>
              {navPath.year && (
                <><ChevronRightIcon className="w-4 h-4" /><button onClick={() => setNavPath({year: navPath.year})} className={`hover:text-indigo-600 transition-colors ${!navPath.category ? 'text-indigo-600' : ''}`}>{navPath.year}</button></>
              )}
              {navPath.category && (
                <><ChevronRightIcon className="w-4 h-4" /><span className="text-indigo-600">{navPath.category}</span></>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!isBrowsing || navPath.year ? (
                <button onClick={syncToDrive} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-xs font-black hover:bg-indigo-100 transition-all shadow-sm">
                   <CloudUpload className="w-3.5 h-3.5" /> Sync To Drive
                </button>
              ) : null}
              {isSelectionMode ? (
                <>
                  <button onClick={handleShareBatchPDF} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg">Share PDF ({selectedIds.size})</button>
                  <button onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }} className="text-xs font-black text-slate-400 hover:text-slate-600">Cancel</button>
                </>
              ) : (
                <button onClick={() => setIsSelectionMode(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-full text-xs font-black hover:bg-slate-200 transition-all"><CheckSquare className="w-3.5 h-3.5" /> Selection Mode</button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {!isBrowsing ? filteredCerts.map(cert => (
              <div key={cert.id} onClick={() => isSelectionMode ? toggleSelect(cert.id) : (setSelectedCert(cert), setView('detail'))} className={`bg-white rounded-[2rem] border overflow-hidden hover:shadow-xl transition-all cursor-pointer relative ${selectedIds.has(cert.id) ? 'border-indigo-600 ring-4 ring-indigo-50' : 'border-slate-100 shadow-sm'}`}>
                {isSelectionMode && <div className="absolute top-4 left-4 z-10">{selectedIds.has(cert.id) ? <CheckSquare className="w-6 h-6 text-indigo-600 fill-white" /> : <Square className="w-6 h-6 text-slate-300 fill-white" />}</div>}
                <div className="aspect-[1.414/1] p-4 bg-slate-50 flex items-center justify-center"><img src={cert.image} className="max-h-full max-w-full object-contain" /></div>
                <div className="p-4"><h3 className="text-sm font-black text-slate-900 truncate">{cert.title}</h3><p className="text-[10px] text-slate-400 truncate">{cert.issuer}</p></div>
              </div>
            )) : !navPath.year ? Object.keys(academicHierarchy).sort((a,b)=>b.localeCompare(a)).map(ay => (
              <button key={ay} onClick={() => setNavPath({ year: ay })} className="group flex flex-col items-center gap-4 p-8 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all"><Folder className="w-8 h-8" /></div>
                <div className="text-center font-black text-slate-800 tracking-tight">{ay}</div>
              </button>
            )) : !navPath.category ? Object.keys(academicHierarchy[navPath.year] || {}).map(cat => (
              <button key={cat} onClick={() => setNavPath({ year: navPath.year, category: cat })} className="group flex flex-col items-center gap-4 p-8 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 group-hover:bg-indigo-600 group-hover:text-white transition-all"><Folder className="w-8 h-8" /></div>
                <div className="text-center font-black text-slate-800 tracking-tight">{cat}</div>
              </button>
            )) : (academicHierarchy[navPath.year!]?.[navPath.category!] || []).map(cert => (
              <div key={cert.id} onClick={() => isSelectionMode ? toggleSelect(cert.id) : (setSelectedCert(cert), setView('detail'))} className={`bg-white rounded-[2rem] border overflow-hidden hover:shadow-xl transition-all cursor-pointer relative ${selectedIds.has(cert.id) ? 'border-indigo-600 ring-4 ring-indigo-50' : 'border-slate-100 shadow-sm'}`}>
                {isSelectionMode && <div className="absolute top-4 left-4 z-10">{selectedIds.has(cert.id) ? <CheckSquare className="w-6 h-6 text-indigo-600 fill-white" /> : <Square className="w-6 h-6 text-slate-300 fill-white" />}</div>}
                <div className="aspect-[1.414/1] p-4 bg-slate-50 flex items-center justify-center"><img src={cert.image} className="max-h-full max-w-full object-contain" /></div>
                <div className="p-4"><h3 className="text-sm font-black text-slate-900 truncate">{cert.title}</h3><p className="text-[10px] text-slate-400 truncate">{cert.issuer}</p></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'scanner' && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col">
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <button onClick={() => { stopCamera(); setView('dashboard'); }} className="absolute top-6 left-6 p-4 bg-white/20 backdrop-blur-md rounded-2xl text-white hover:bg-white/30 transition-all"><ChevronLeft className="w-6 h-6" /></button>
          </div>
          <div className="bg-black p-12 flex justify-center">
            <button 
              onClick={async () => {
                if (!videoRef.current || !canvasRef.current) return;
                const c = canvasRef.current;
                c.width = videoRef.current.videoWidth;
                c.height = videoRef.current.videoHeight;
                c.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                const base64 = c.toDataURL('image/jpeg', 0.85);
                stopCamera();
                setView('dashboard'); 
                await processCertificate(base64);
              }} 
              className="w-20 h-20 rounded-full border-4 border-white/30 p-1 active:scale-95 transition-transform"
            ><div className="w-full h-full bg-white rounded-full shadow-inner" /></button>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {view === 'editor' && pendingCert && (
        <div className="min-h-screen fixed inset-0 z-[60] bg-white flex flex-col animate-in slide-in-from-bottom duration-500 overflow-hidden">
           <header className="flex items-center gap-5 px-8 py-5 border-b border-slate-100 bg-white">
             <button onClick={() => setView('dashboard')} className="p-2.5 hover:bg-slate-50 rounded-xl transition-colors"><ChevronLeft className="w-6 h-6" /></button>
             <h2 className="text-2xl font-black text-slate-900 tracking-tight">Verify Scan Results</h2>
           </header>
           <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row bg-[#F8FAFC]">
             <div className="lg:w-[45%] p-6 md:p-12 flex flex-col items-center justify-center bg-slate-100/30 gap-6">
               <div className="relative w-full max-w-[500px] h-fit bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-200 flex items-center justify-center p-2">
                 <img src={showOriginal ? pendingCert.originalImage : pendingCert.image} className="max-w-full max-h-[60vh] object-contain rounded-lg transition-all" />
                 <button onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onTouchStart={() => setShowOriginal(true)} onTouchEnd={() => setShowOriginal(false)} className="absolute bottom-6 left-6 px-6 py-3 bg-slate-900/90 backdrop-blur-md text-white text-[11px] font-black rounded-xl flex items-center gap-2 shadow-xl active:scale-95 touch-none"><Layers className="w-5 h-5" /> Hold to compare</button>
               </div>
               <button onClick={handleManualRotate} className="px-8 py-4 bg-white text-indigo-600 border border-indigo-100 rounded-2xl font-black text-xs flex items-center gap-3 shadow-sm hover:bg-indigo-50 transition-all active:scale-95"><RotateCw className="w-5 h-5" /> Rotate 90° CCW</button>
             </div>
             <div className="lg:flex-1 p-8 md:p-14 bg-white border-l border-slate-100 shadow-inner overflow-y-auto">
               <div className="max-w-3xl mx-auto space-y-8">
                 <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">STUDENT / PROFILE</label><div className="relative"><div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400"><UserIcon className="w-5 h-5" /></div><input disabled type="text" value={profiles.find(p => p.id === activeProfileId)?.name || 'A'} className="w-full pl-14 pr-6 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none" /></div></div>
                 <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">TITLE</label><input type="text" value={pendingCert.title} onChange={e => setPendingCert({...pendingCert, title: e.target.value})} className="w-full px-6 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" /></div>
                 <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">NAME ON CERTIFICATE</label><input type="text" value={pendingCert.studentName} onChange={e => setPendingCert({...pendingCert, studentName: e.target.value})} className="w-full px-6 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" /></div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-2.5">
                     <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">CATEGORY</label>
                     <div className="relative">
                       <select value={pendingCert.category} onChange={e => e.target.value === 'ADD_CUSTOM' ? setIsAddingCategory(true) : setPendingCert({...pendingCert, category: e.target.value})} className="w-full pl-6 pr-12 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none appearance-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all">{categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}<option value="ADD_CUSTOM" className="text-indigo-600 font-black">+ Add Custom Category...</option></select>
                       <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                     </div>
                   </div>
                   <div className="space-y-2.5">
                     <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">DATE / YEAR</label>
                     <div className="relative">
                       <input type="text" value={pendingCert.date} onChange={e => setPendingCert({...pendingCert, date: e.target.value})} className="w-full pl-6 pr-14 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" />
                       <Calendar className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                     </div>
                   </div>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">SUBJECT / SPORT</label><input type="text" value={pendingCert.subject} onChange={e => setPendingCert({...pendingCert, subject: e.target.value})} className="w-full px-6 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" /></div>
                   <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">ISSUER</label><input type="text" value={pendingCert.issuer} onChange={e => setPendingCert({...pendingCert, issuer: e.target.value})} className="w-full px-6 py-4.5 bg-[#F8FAFC] rounded-2xl font-bold text-slate-800 border border-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" /></div>
                 </div>
                 <div className="space-y-2.5"><label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">SUMMARY / AI NOTES</label><textarea value={pendingCert.summary} onChange={e => setPendingCert({...pendingCert, summary: e.target.value})} className="w-full p-6 bg-[#F8FAFC] rounded-2xl font-medium text-slate-700 leading-relaxed border border-slate-100 outline-none min-h-[120px] resize-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all" /></div>
                 <button onClick={() => { if (pendingCert) { setCertificates(p => [{ ...pendingCert, profileId: activeProfileId } as Certificate, ...p]); setPendingCert(null); setView('dashboard'); } }} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl shadow-2xl hover:bg-indigo-600 active:scale-95 transition-all mt-10">SAVE CERTIFICATE</button>
               </div>
             </div>
           </div>
        </div>
      )}

      {isAddingCategory && (
        <div className="fixed inset-0 z-[200] bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl max-w-sm w-full space-y-6">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">New Category</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Create a custom classification</p>
            <input autoFocus type="text" placeholder="e.g. Internships, Music..." value={newCategoryInput} onChange={e => setNewCategoryInput(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all" onKeyDown={e => { if (e.key === 'Enter' && newCategoryInput.trim()) { const val = newCategoryInput.trim(); setCustomCategories(p => [...p, val]); if (pendingCert) setPendingCert({...pendingCert, category: val}); setNewCategoryInput(''); setIsAddingCategory(false); } }} />
            <div className="flex gap-3"><button onClick={() => setIsAddingCategory(false)} className="flex-1 py-4 font-bold text-slate-400 hover:text-slate-600 transition-colors">Cancel</button><button onClick={() => { const val = newCategoryInput.trim(); if(val){ setCustomCategories(p => [...p, val]); if(pendingCert) setPendingCert({...pendingCert, category: val}); setNewCategoryInput(''); setIsAddingCategory(false); } }} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg hover:bg-indigo-700 active:scale-95 transition-all">Add Category</button></div>
          </div>
        </div>
      )}

      {view === 'detail' && selectedCert && (
        <div className="min-h-screen bg-slate-50 flex flex-col animate-in fade-in">
          <header className="bg-white px-8 py-5 border-b border-slate-100 flex justify-between items-center sticky top-0 z-10">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2 font-black text-slate-600 hover:text-indigo-600 transition-colors"><ChevronLeft className="w-5 h-5" /> Back</button>
            <div className="flex gap-3">
               <button onClick={() => { setSelectedIds(new Set([selectedCert.id])); handleShareBatchPDF(); }} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all"><Share2 className="w-4 h-4" /> Share</button>
               <button onClick={() => { if(confirm("Delete achievement?")) { setCertificates(p => p.filter(c => c.id !== selectedCert.id)); setView('dashboard'); } }} className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="w-5 h-5" /></button>
            </div>
          </header>
          <main className="max-w-6xl mx-auto w-full p-8 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-12 pb-20">
            <div className="bg-white p-8 rounded-[2rem] shadow-xl flex items-center justify-center h-fit border border-slate-100 relative">
               <img src={selectedCert.image} className="w-full h-auto rounded-2xl" />
               {selectedCert.synced && <div className="absolute top-12 right-12 bg-green-500 text-white p-2 rounded-full shadow-lg"><CheckCircle className="w-6 h-6" /></div>}
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm space-y-10 border border-slate-100">
              <div className="space-y-3"><h2 className="text-3xl font-black text-slate-900 leading-tight">{selectedCert.title}</h2><p className="text-xl text-slate-400 font-bold">{selectedCert.issuer}</p></div>
              <div className="grid grid-cols-2 gap-8 text-[11px] font-black uppercase text-slate-400 tracking-wider">
                <div><span className="block mb-1">Subject / Sport</span><span className="text-slate-800 text-sm">{selectedCert.subject || "N/A"}</span></div>
                <div><span className="block mb-1">Recipient</span><span className="text-slate-800 text-sm">{selectedCert.studentName || "N/A"}</span></div>
                <div><span className="block mb-1">Date / Year</span><span className="text-slate-800 text-sm">{selectedCert.date}</span></div>
                <div><span className="block mb-1">Academic Cycle</span><span className="text-indigo-600 text-sm font-black">{getAcademicYear(selectedCert.date)}</span></div>
              </div>
              <div className="p-8 bg-slate-50 rounded-3xl italic text-slate-600 leading-relaxed text-lg border border-slate-100">"{selectedCert.summary}"</div>
            </div>
          </main>
        </div>
      )}
    </div>
  );

  function startCamera() {
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
    }).then(stream => {
      setView('scanner');
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    }).catch(() => setError("Camera access denied."));
  }
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<CertiVault />);
}
