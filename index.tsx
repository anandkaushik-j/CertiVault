
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
  Folder, 
  Calendar, 
  X, 
  Check, 
  CheckCircle,
  ChevronRight as ChevronRightIcon,
  Home,
  CheckSquare,
  Square,
  Search,
  Eraser,
  Plus,
  AlertCircle,
  ImageIcon,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

// --- Configuration & Constants ---
const STORAGE_KEY = 'certivault_pro_v18_final_fix'; 
const USER_SESSION_KEY = 'certivault_user_session';
const BASE_CATEGORIES = ['Academics', 'Sports', 'Arts', 'Competitions', 'Workshops', 'Other'];
const PRIORITY_CATEGORIES = ['Academics', 'Sports', 'Arts'];

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
  originalImage?: string; 
  profileId: string;
  studentName: string; 
  title: string;
  issuer: string;
  date: string; 
  category: string;
  summary: string; 
  createdAt: number;
}

interface User {
  name: string;
  firstName: string;
  initials: string;
  email: string;
}

// --- Helper Functions ---
const getAcademicYear = (dateStr: string) => {
  if (!dateStr) return "Unknown Year";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Unknown Year";
  const year = date.getFullYear();
  const month = date.getMonth(); 
  // Academic cycle: April/May to March
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

const pdfToImage = async (file: File): Promise<string> => {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF Library Missing from index.html");
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 }); 
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error("Canvas context failed");
  canvas.height = viewport.height; canvas.width = viewport.width;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
};

const CertiVault = () => {
  const [user] = useState<User>(() => {
    const saved = localStorage.getItem(USER_SESSION_KEY);
    return saved ? JSON.parse(saved) : { name: 'Subhavya Anand', firstName: 'Subhavya', initials: 'SA', email: '' };
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
  const [isAddingCustomCategory, setIsAddingCustomCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

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
        if (data.profiles?.length > 0) {
          setProfiles(data.profiles);
          if (data.activeProfileId) setActiveProfileId(data.activeProfileId);
        }
        if (data.certificates) setCertificates(data.certificates);
        if (data.customCategories) setCustomCategories(data.customCategories);
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, certificates, activeProfileId, customCategories }));
  }, [profiles, certificates, activeProfileId, customCategories]);

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setView('scanner');
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch (err) { setError("Camera access denied."); }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const processCertificate = async (base64Data: string) => {
    setIsProcessing(true);
    setProcessStatus('AI: Rectifying scan...');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const pureBase64 = base64Data.split(',')[1] || base64Data;
      
      let cleanedImage = base64Data;
      try {
        const rectificationResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              { inlineData: { data: pureBase64, mimeType: 'image/jpeg' } },
              { text: "Rectify this certificate. Remove the person's fingers, all shadows, and background clutter. Transform it into a clean, flat rectangular scan as if from a scanner. DO NOT ADD ANY WATERMARKS, LOGOS, OR OVERLAY TEXT. Provide the processed image only." }
            ]
          }
        });
        const imagePart = rectificationResponse.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart && imagePart.inlineData) cleanedImage = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      } catch (err) { console.warn("Rectification failed."); }

      setProcessStatus('AI: Extracting metadata...');
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { 
          parts: [
            { inlineData: { data: cleanedImage.split(',')[1], mimeType: 'image/jpeg' } }, 
            { text: `Extract metadata from this certificate. Return ONLY valid JSON. Standardize date to YYYY-MM-DD. 
                     STRICTLY CATEGORIZE into ONE of these: ${categoriesList.join(', ')}. 
                     If no match, use 'Other'.` }
          ] 
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              studentName: { type: Type.STRING },
              issuer: { type: Type.STRING },
              date: { type: Type.STRING },
              category: { type: Type.STRING },
              summary: { type: Type.STRING }
            },
            required: ["title", "studentName", "issuer", "date", "category", "summary"]
          }
        }
      });

      const data = JSON.parse(response.text.trim());
      const finalCategory = categoriesList.find(c => c.toLowerCase() === data.category?.toLowerCase()) || 'Other';

      setPendingCert({
        id: Date.now().toString(),
        image: cleanedImage, profileId: activeProfileId,
        studentName: data.studentName || "", title: data.title || "Record Scan",
        issuer: data.issuer || "", date: data.date || new Date().toISOString().split('T')[0],
        category: finalCategory, summary: data.summary || "", createdAt: Date.now()
      });
      setView('editor');
    } catch (err: any) {
      setError("AI analysis failed. Manual entry enabled.");
      setPendingCert({
        id: Date.now().toString(), image: base64Data, profileId: activeProfileId,
        studentName: "", title: "New Certificate", issuer: "", date: new Date().toISOString().split('T')[0],
        category: 'Other', summary: "", createdAt: Date.now()
      });
      setView('editor');
    } finally { setIsProcessing(false); setProcessStatus(''); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setProcessStatus('Reading document...');
    try {
      let imageData = (file.type === 'application/pdf') ? await pdfToImage(file) : await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      await processCertificate(await resizeImage(imageData));
    } catch (err: any) { setError("Failed to load document."); setIsProcessing(false); }
    e.target.value = '';
  };

  const generatePDFBlob = async (certs: Certificate[]) => {
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const margin = 20;

    for (let i = 0; i < certs.length; i++) {
      if (i > 0) doc.addPage();
      const cert = certs[i];
      const img = new Image();
      img.src = cert.image;
      await new Promise(r => img.onload = r);

      doc.setFont("helvetica", "bold").setFontSize(18).text(cert.title, margin, 30);
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100).text(`Issued by: ${cert.issuer}`, margin, 38);
      
      // Certificate Image (Cleaned, No Watermark)
      const imgHeight = 120;
      doc.addImage(cert.image, 'JPEG', margin, 45, pageWidth - (margin * 2), imgHeight);

      // Category Description Section
      let y = 45 + imgHeight + 15;
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(40).text("Achievement Category Details:", margin, y);
      y += 6;
      const catDesc = CATEGORY_DESCRIPTIONS[cert.category] || "Special achievement recognition.";
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(80).text(`${cert.category}: ${catDesc}`, margin, y);
      
      // Award Reason / Summary Section
      y += 12;
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(40).text("Reason for Award / Summary:", margin, y);
      y += 6;
      const lines = doc.splitTextToSize(cert.summary || "This certificate acknowledges the outstanding accomplishments and participation of the recipient.", pageWidth - (margin * 2));
      doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(60).text(lines, margin, y);
    }
    return doc.output('blob');
  };

  const handleShareBatchPDF = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    setProcessStatus('Compiling PDF...');
    try {
      const certs = certificates.filter(c => selectedIds.has(c.id));
      const blob = await generatePDFBlob(certs);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CertiVault_Export_${Date.now()}.pdf`;
      a.click();
    } catch (err) { setError("PDF export failed."); }
    setIsProcessing(false);
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const filteredCerts = useMemo(() => {
    let res = certificates.filter(c => c.profileId === activeProfileId);
    
    // Typed Search logic
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      res = res.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.issuer.toLowerCase().includes(q) || 
        c.category.toLowerCase().includes(q) ||
        getAcademicYear(c.date).toLowerCase().includes(q)
      );
    }
    
    // Tag Filter logic
    if (selectedFilterTags.length > 0) {
      res = res.filter(c => 
        selectedFilterTags.some(tag => tag.toLowerCase() === c.category.toLowerCase()) || 
        selectedFilterTags.some(tag => tag.toLowerCase() === getAcademicYear(c.date).toLowerCase())
      );
    }
    
    return res;
  }, [certificates, activeProfileId, searchQuery, selectedFilterTags]);

  const academicHierarchy = useMemo(() => {
    const h: Record<string, Record<string, Certificate[]>> = {};
    filteredCerts.forEach(cert => {
      const ay = getAcademicYear(cert.date);
      const cat = cert.category || 'Other';
      if (!h[ay]) h[ay] = {};
      if (!h[ay][cat]) h[ay][cat] = [];
      h[ay][cat].push(cert);
    });
    return h;
  }, [filteredCerts]);

  const sortedYears = useMemo(() => Object.keys(academicHierarchy).sort((a, b) => b.localeCompare(a)), [academicHierarchy]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    certificates.filter(c => c.profileId === activeProfileId).forEach(c => years.add(getAcademicYear(c.date)));
    return Array.from(years).sort((a,b) => b.localeCompare(a));
  }, [certificates, activeProfileId]);

  const hasActiveFilters = searchQuery.trim().length > 0 || selectedFilterTags.length > 0;
  const isBrowsingRoot = !hasActiveFilters && !navPath.year;

  const toggleFilterTag = (tag: string) => {
    setSelectedFilterTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 select-none overflow-x-hidden">
      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
          <h2 className="text-xl font-black">{processStatus}</h2>
        </div>
      )}

      {error && (
        <div className="fixed top-4 left-4 right-4 z-[300] p-4 bg-slate-900 text-white rounded-xl flex justify-between items-center shadow-2xl animate-in slide-in-from-top-4">
          <span className="text-sm font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-indigo-400" /> {error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {view === 'dashboard' && (
        <div className="max-w-4xl mx-auto p-4 md:p-8 animate-in fade-in">
          <header className="flex justify-between items-center mb-10">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg"><FileText className="w-6 h-6" /></div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">CertiVault</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-slate-50 px-8 py-3 rounded-full border border-slate-100 flex items-center shadow-sm transition-all">
                  <span className="font-black text-slate-800 text-lg tracking-tight leading-none">
                    {profiles.find(p => p.id === activeProfileId)?.name || 'No Profile'}
                  </span>
              </div>
              <button onClick={() => setIsAddingProfile(true)} className="p-3 bg-slate-50 rounded-full border border-slate-100 text-slate-400 hover:text-indigo-600 transition-colors shadow-sm"><Plus className="w-6 h-6" /></button>
            </div>
          </header>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8 space-y-6 mb-10">
            <div className="relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input type="text" placeholder="Search record..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-14 pr-4 py-4 bg-slate-50 rounded-2xl font-bold text-sm outline-none placeholder:text-slate-400" />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              {availableYears.map(year => (
                <button key={year} onClick={() => toggleFilterTag(year)} className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase shrink-0 transition-all ${selectedFilterTags.includes(year) ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{year}</button>
              ))}
              <div className="w-[1px] h-6 bg-slate-200 shrink-0 mx-2" />
              {PRIORITY_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => toggleFilterTag(cat)} className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase shrink-0 transition-all ${selectedFilterTags.includes(cat) ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{cat}</button>
              ))}
              {hasActiveFilters && <button onClick={() => { setSearchQuery(''); setSelectedFilterTags([]); }} className="px-3 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase shrink-0"><Eraser className="w-4 h-4" /></button>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-12">
            <button onClick={startCamera} className="py-6 bg-slate-900 text-white rounded-3xl font-black flex items-center justify-center gap-3 active:scale-95 transition-transform shadow-xl"><Camera className="w-5 h-5" /> Scan</button>
            <button onClick={() => fileInputRef.current?.click()} className="py-6 bg-white text-slate-900 border border-slate-200 rounded-3xl font-black flex items-center justify-center gap-3 active:scale-95 transition-transform shadow-sm"><Upload className="w-5 h-5" /> Import</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,application/pdf" className="hidden" />
          </div>

          <div className="flex justify-between items-center mb-6 px-1">
            <div className="flex items-center gap-2 text-sm font-black text-indigo-600 uppercase tracking-tight">
              <button onClick={() => {setNavPath({}); setSearchQuery(''); setSelectedFilterTags([]);}} className="flex items-center gap-2">
                <Home className="w-5 h-5" /> ROOT
              </button>
              {navPath.year && <><ChevronRightIcon className="w-4 h-4 text-slate-300" /><button onClick={() => setNavPath({ year: navPath.year })} className="hover:text-indigo-800">{navPath.year}</button></>}
              {navPath.category && <><ChevronRightIcon className="w-4 h-4 text-slate-300" /><span>{navPath.category}</span></>}
            </div>
            <div className="flex gap-2">
               {isSelectionMode ? (
                 <button onClick={handleShareBatchPDF} className="bg-indigo-600 text-white px-6 py-2.5 rounded-full text-xs font-black shadow-lg">SHARE ({selectedIds.size})</button>
               ) : (
                 <button onClick={() => setIsSelectionMode(true)} className="bg-slate-50 text-slate-500 px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest border border-slate-100 shadow-sm">Select</button>
               )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            {hasActiveFilters ? (
              filteredCerts.map(cert => (
                <div key={cert.id} onClick={() => isSelectionMode ? setSelectedIds(p => { const n = new Set(p); if(n.has(cert.id)) n.delete(cert.id); else n.add(cert.id); return n; }) : (setSelectedCert(cert), setView('detail'))} className={`bg-white rounded-3xl border overflow-hidden relative transition-all ${selectedIds.has(cert.id) ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-xl' : 'border-slate-50 shadow-sm hover:shadow-md'}`}>
                  <div className="aspect-[1.414/1] bg-slate-50 p-2 flex items-center justify-center"><img src={cert.image} className="max-h-full object-contain" /></div>
                  <div className="p-4"><h3 className="text-sm font-black truncate text-slate-800">{cert.title}</h3><p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mt-1 truncate">{cert.issuer}</p></div>
                  {isSelectionMode && <div className="absolute top-3 right-3">{selectedIds.has(cert.id) ? <CheckCircle className="w-6 h-6 text-indigo-600 fill-white shadow-sm" /> : <div className="w-6 h-6 border-2 border-slate-200 rounded-full bg-white/60" />}</div>}
                </div>
              ))
            ) : isBrowsingRoot ? sortedYears.map(ay => (
              <button key={ay} onClick={() => setNavPath({ year: ay })} className="flex flex-col items-center gap-4 p-8 bg-white rounded-[2.5rem] border border-slate-50 shadow-sm hover:shadow-md active:scale-95 transition-all text-center">
                <Folder className="w-14 h-14 text-indigo-400 fill-indigo-50" />
                <div>
                  <span className="font-black text-slate-800 text-base block">{ay}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{Object.values(academicHierarchy[ay] || {}).flat().length} Records</span>
                </div>
              </button>
            )) : !navPath.category ? Object.keys(academicHierarchy[navPath.year!] || {}).map(cat => (
              <button key={cat} onClick={() => setNavPath(p => ({ ...p, category: cat }))} className="flex flex-col items-center gap-4 p-8 bg-white rounded-[2.5rem] border border-slate-50 shadow-sm hover:shadow-md active:scale-95 transition-all text-center">
                <Folder className="w-14 h-14 text-slate-200" />
                <div>
                  <span className="font-black text-slate-800 text-base block">{cat}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{academicHierarchy[navPath.year!]?.[cat]?.length || 0} Files</span>
                </div>
              </button>
            )) : (academicHierarchy[navPath.year!]?.[navPath.category!] || []).map(cert => (
              <div key={cert.id} onClick={() => isSelectionMode ? setSelectedIds(p => { const n = new Set(p); if(n.has(cert.id)) n.delete(cert.id); else n.add(cert.id); return n; }) : (setSelectedCert(cert), setView('detail'))} className={`bg-white rounded-3xl border overflow-hidden relative transition-all ${selectedIds.has(cert.id) ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-xl' : 'border-slate-50 shadow-sm hover:shadow-md'}`}>
                <div className="aspect-[1.414/1] bg-slate-50 p-2 flex items-center justify-center"><img src={cert.image} className="max-h-full object-contain" /></div>
                <div className="p-4"><h3 className="text-sm font-black truncate text-slate-800">{cert.title}</h3><p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mt-1 truncate">{cert.issuer}</p></div>
                {isSelectionMode && <div className="absolute top-3 right-3">{selectedIds.has(cert.id) ? <CheckCircle className="w-6 h-6 text-indigo-600 fill-white shadow-sm" /> : <div className="w-6 h-6 border-2 border-slate-200 rounded-full bg-white/60" />}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'scanner' && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col">
          <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
          <button onClick={() => { stopCamera(); setView('dashboard'); }} className="absolute top-8 left-8 p-4 bg-white/20 backdrop-blur-md rounded-2xl text-white"><ChevronLeft className="w-6 h-6" /></button>
          <div className="bg-black p-10 flex justify-center">
            <button onClick={async () => {
                if (!videoRef.current) return;
                const canvas = document.createElement('canvas');
                canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight;
                canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
                const b = canvas.toDataURL('image/jpeg', 0.85);
                stopCamera(); setView('dashboard'); await processCertificate(await resizeImage(b));
              }} className="w-20 h-20 rounded-full border-4 border-white/30 p-1 active:scale-90 transition-transform"><div className="w-full h-full bg-white rounded-full" /></button>
          </div>
        </div>
      )}

      {view === 'editor' && pendingCert && (
        <div className="fixed inset-0 z-[150] bg-white flex flex-col animate-in slide-in-from-bottom duration-500">
          <header className="p-6 flex justify-between items-center border-b bg-white z-[160] shadow-sm">
            <button onClick={() => setView('dashboard')} className="p-2.5 bg-slate-50 rounded-xl"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-600" /> Verify Achievement</h2>
            <button onClick={() => { 
                if(!pendingCert.title) return setError("Title required.");
                setCertificates(p => [{ ...pendingCert, profileId: activeProfileId } as Certificate, ...p]); 
                setView('dashboard'); 
              }} className="text-indigo-600 font-black px-4 uppercase text-sm tracking-widest">Save</button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32 bg-slate-50/20">
            <div className="aspect-[1.414/1] w-full bg-white rounded-[2.5rem] flex items-center justify-center p-4 border border-slate-100 shadow-2xl mx-auto max-w-lg">
               <img src={pendingCert.image} className="max-h-full object-contain rounded-lg" />
            </div>
            <div className="space-y-6 max-w-lg mx-auto bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Achievement Title</label>
                <input type="text" value={pendingCert.title} onChange={e => setPendingCert({...pendingCert, title: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border-none outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Issued By</label>
                <input type="text" value={pendingCert.issuer} onChange={e => setPendingCert({...pendingCert, issuer: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border-none outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</label>
                    <button onClick={() => setIsAddingCustomCategory(true)} className="text-[9px] text-indigo-600 font-black uppercase tracking-widest">+ Custom</button>
                  </div>
                  {isAddingCustomCategory ? (
                    <div className="flex gap-2">
                      <input autoFocus value={newCategoryInput} onChange={(e) => setNewCategoryInput(e.target.value)} placeholder="New..." className="w-full p-4 bg-indigo-50 rounded-2xl font-bold text-sm outline-none" />
                      <div className="flex flex-col gap-1">
                        <button onClick={() => { if (newCategoryInput.trim()) { setCustomCategories(p => [...p, newCategoryInput.trim()]); setPendingCert({...pendingCert, category: newCategoryInput.trim()}); setNewCategoryInput(''); setIsAddingCustomCategory(false); } }} className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm"><Check className="w-4 h-4" /></button>
                        <button onClick={() => { setIsAddingCustomCategory(false); setNewCategoryInput(''); }} className="p-2 bg-slate-200 text-slate-500 rounded-lg shadow-sm"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ) : (
                    <select value={pendingCert.category} onChange={e => setPendingCert({...pendingCert, category: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border-none outline-none">
                      {categoriesList.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Award Date</label>
                  <input type="date" value={pendingCert.date} onChange={e => setPendingCert({...pendingCert, date: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border-none outline-none" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Student Name</label>
                <input type="text" value={pendingCert.studentName} onChange={e => setPendingCert({...pendingCert, studentName: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border-none outline-none" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">AI Context / Summary</label>
                <textarea value={pendingCert.summary} onChange={e => setPendingCert({...pendingCert, summary: e.target.value})} className="w-full p-5 bg-slate-50 rounded-2xl font-medium text-xs h-32 border-none outline-none shadow-inner resize-none leading-relaxed" />
              </div>
            </div>
          </div>
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t z-[170]">
            <button onClick={() => { if(!pendingCert.title) return; setCertificates(p => [{ ...pendingCert, profileId: activeProfileId } as Certificate, ...p]); setView('dashboard'); }} className="w-full py-5 bg-indigo-600 text-white rounded-3xl font-black shadow-xl shadow-indigo-100 uppercase tracking-widest text-sm">Vault Achievement</button>
          </div>
        </div>
      )}

      {view === 'detail' && selectedCert && (
        <div className="fixed inset-0 z-[150] bg-white flex flex-col p-6 overflow-y-auto animate-in fade-in">
          <div className="flex justify-between items-center mb-8">
            <button onClick={() => setView('dashboard')} className="p-3 bg-slate-50 rounded-2xl"><ChevronLeft className="w-6 h-6" /></button>
            <div className="flex gap-4">
               <button onClick={async () => {
                 setIsProcessing(true);
                 setProcessStatus('Preparing PDF...');
                 try {
                   const blob = await generatePDFBlob([selectedCert]);
                   const url = URL.createObjectURL(blob);
                   const a = document.createElement('a');
                   a.href = url;
                   a.download = `${selectedCert.title.replace(/\s+/g, '_')}.pdf`;
                   a.click();
                 } catch(e) { setError("PDF generation failed."); }
                 setIsProcessing(false);
               }} className="text-indigo-600 font-black text-xs uppercase tracking-widest flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-xl"><Share2 className="w-4 h-4" /> Share PDF</button>
               <button onClick={() => { if(confirm("Permanently delete this?")) { setCertificates(p => p.filter(c => c.id !== selectedCert.id)); setView('dashboard'); } }} className="text-red-500 font-black text-xs uppercase tracking-widest flex items-center gap-2 px-4 py-2 bg-red-50 rounded-xl"><Trash2 className="w-4 h-4" /> Delete</button>
            </div>
          </div>
          <div className="aspect-[1.414/1] w-full bg-white rounded-[3rem] flex items-center justify-center p-6 border border-slate-50 mb-10 shadow-2xl max-w-2xl mx-auto">
            <img src={selectedCert.image} className="max-h-full object-contain rounded-lg" />
          </div>
          <div className="max-w-xl mx-auto w-full space-y-8 pb-12">
            <div className="space-y-2">
              <h2 className="text-3xl font-black leading-tight text-slate-900">{selectedCert.title}</h2>
              <div className="flex gap-2">
                <span className="bg-slate-100 px-3 py-1 rounded-lg text-[10px] font-black uppercase text-slate-500 tracking-widest">{selectedCert.issuer}</span>
                <span className="bg-indigo-50 px-3 py-1 rounded-lg text-[10px] font-black uppercase text-indigo-600 tracking-widest">{getAcademicYear(selectedCert.date)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8 text-[11px] font-black text-slate-400 uppercase tracking-widest border-t border-slate-100 pt-8">
              <div>Category: <span className="text-slate-900 block mt-2 text-sm">{selectedCert.category}</span></div>
              <div>Recipient: <span className="text-slate-900 block mt-2 text-sm">{selectedCert.studentName || "N/A"}</span></div>
              <div>Issue Date: <span className="text-slate-900 block mt-2 text-sm">{selectedCert.date}</span></div>
              <div>Vault Path: <span className="text-indigo-600 block mt-2 text-sm font-mono truncate">ROOT/{getAcademicYear(selectedCert.date)}/{selectedCert.category}</span></div>
            </div>
            <div className="p-8 bg-slate-50 rounded-[2.5rem] text-base italic text-slate-600 leading-relaxed border border-slate-100 shadow-inner">
              "{selectedCert.summary || "No description provided."}"
            </div>
          </div>
        </div>
      )}

      {isAddingProfile && (
        <div className="fixed inset-0 z-[250] bg-black/50 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl w-full max-w-sm space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-black tracking-tight text-slate-900">New Achievement Vault</h3>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Organize by person or department</p>
            </div>
            <input autoFocus type="text" placeholder="Profile name..." value={newProfileName} onChange={e => setNewProfileName(e.target.value)} className="w-full p-5 bg-slate-50 rounded-2xl font-black outline-none border border-slate-100" />
            <div className="flex gap-4">
              <button onClick={() => setIsAddingProfile(false)} className="flex-1 py-4 text-slate-400 font-black text-xs uppercase tracking-widest">Cancel</button>
              <button onClick={() => { if(newProfileName.trim()) { const n = { id: Date.now().toString(), name: newProfileName.trim() }; setProfiles(p => [...p, n]); setActiveProfileId(n.id); setNewProfileName(''); setIsAddingProfile(false); setNavPath({}); } }} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100">Create Vault</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<CertiVault />);
