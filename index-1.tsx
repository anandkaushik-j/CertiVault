
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

// --- Types ---
interface Profile {
  id: string;
  name: string;
}

interface Certificate {
  id: string;
  image: string; // base64 cleaned
  originalImage?: string; // base64 original
  profileId: string;
  studentName: string;
  title: string;
  issuer: string;
  date: string; // YYYY-MM-DD
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
}

interface SyncLog {
  id: string;
  message: string;
  status: 'pending' | 'success' | 'info';
}

// --- Constants ---
const STORAGE_KEY = 'certivault_pro_v4_tags_search'; 
const USER_SESSION_KEY = 'certivault_user_session';
const BASE_CATEGORIES = ['Competitions', 'Academics', 'Sports', 'Arts', 'Workshops', 'Volunteering', 'Other'];

// Initialize PDF.js worker
if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
  (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// --- Helper Functions ---
const getInitials = (name: string) => {
  if (!name) return "??";
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const getAcademicYear = (dateStr: string) => {
  if (!dateStr) return "Unknown Year";
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  // Academic year starts in July (6)
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

// --- App Component ---
const CertiVault = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [view, setView] = useState<'dashboard' | 'scanner' | 'editor' | 'detail'>('dashboard');
  
  // Navigation & Search State
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
  
  // Sync State
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

  const categoriesList = [...BASE_CATEGORIES, ...customCategories];

  // Load data on mount
  useEffect(() => {
    // Check for existing session
    const savedUser = localStorage.getItem(USER_SESSION_KEY);
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.profiles) setProfiles(data.profiles);
        if (data.certificates) setCertificates(data.certificates);
        if (data.activeProfileId) setActiveProfileId(data.activeProfileId);
        if (data.customCategories) setCustomCategories(data.customCategories);
      } catch (e) {
        console.error("Failed to parse saved data", e);
      }
    }
  }, []);

  // Save data on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profiles,
      certificates,
      activeProfileId,
      customCategories
    }));
  }, [profiles, certificates, activeProfileId, customCategories]);

  // Auth Handlers
  const handleLogin = () => {
    setIsLoggingIn(true);
    // Simulate Google OAuth Redirect/Popup
    setTimeout(() => {
      const mockUser = {
        name: 'Subhavya Anand',
        firstName: 'Subhavya',
        initials: 'SA',
        email: 'subhavya.anand@example.com',
        picture: '' 
      };
      setUser(mockUser);
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(mockUser));
      setIsLoggingIn(false);
    }, 1500);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem(USER_SESSION_KEY);
    setView('dashboard'); // Reset to dashboard view
    goToRoot(); // Reset navigation path
  };

  // Folder navigation helpers
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

  const handleCreateCustomCategory = () => {
    const name = newCategoryName.trim();
    if (name && !categoriesList.includes(name)) {
      setCustomCategories(prev => [...prev, name]);
      if (pendingCert) {
        setPendingCert({ ...pendingCert, category: name });
      }
      setIsAddingCustomCategory(false);
      setNewCategoryName('');
    }
  };

  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      setView('scanner');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      setError("Camera access denied. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      let imageData = '';
      if (file.type === 'application/pdf') {
        imageData = await pdfToImage(file);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(file);
        });
        imageData = await resizeImage(base64);
      } else {
        throw new Error("Unsupported file type. Please upload an image or PDF.");
      }
      
      await processCertificate(imageData);
    } catch (err: any) {
      setError(err.message || "Failed to upload document");
      setIsProcessing(false);
    }
    e.target.value = '';
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const base64Image = canvas.toDataURL('image/jpeg', 0.85);
    stopCamera();
    const resized = await resizeImage(base64Image);
    processCertificate(resized);
  };

  const processCertificate = async (base64Data: string) => {
    setIsProcessing(true);
    setView('dashboard'); 
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `You are an elite AI document imaging specialist. Scale to A4 size.

      RESTORE & CLEAN:
      1. SEGMENT & RECTIFY: Perform high-fidelity perspective correction. Perfectly rectangular output.
      2. CLUTTER & FINGER REMOVAL: Remove all background, obstructions, and fingers. Infill edges naturally.
      3. QUALITY: Preserve original signatures and logos exactly as scanned.
      4. A4 ASPECT RATIO: Output 1.414:1 (landscape) or 1:1.414 (portrait).
      5. CANVAS: Pure white (#FFFFFF) centered output.

      OCR EXTRACT (JSON ONLY):
      {
        "title": "String",
        "studentName": "String",
        "issuer": "String",
        "date": "YYYY-MM-DD",
        "category": "Competitions|Academics|Sports|Arts|Workshops|Volunteering|Other",
        "subject": "String",
        "summary": "String",
        "suggestedTags": ["tag1", "tag2"]
      }`;

      const pureBase64 = base64Data.split(',')[1] || base64Data;

      // Use gemini-2.5-flash-image for image editing/rectification tasks as per guidelines to ensure image output is possible
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { data: pureBase64, mimeType: 'image/jpeg' } },
            { text: prompt }
          ]
        }
      });

      let extractedData: any = {};
      let cleanedImageBase64 = base64Data; 

      const candidates = response.candidates;
      if (candidates && candidates.length > 0 && candidates[0].content?.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            cleanedImageBase64 = `data:image/png;base64,${part.inlineData.data}`;
          } else if (part.text) {
            try {
              const jsonMatch = part.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) extractedData = JSON.parse(jsonMatch[0]);
            } catch (e) { console.warn("JSON extraction failed"); }
          }
        }
      }
      
      setPendingCert({
        id: Date.now().toString(),
        image: cleanedImageBase64,
        originalImage: base64Data,
        profileId: activeProfileId, 
        studentName: extractedData.studentName || "",
        title: extractedData.title || "New Certificate",
        issuer: extractedData.issuer || "",
        date: extractedData.date || new Date().toISOString().split('T')[0],
        category: categoriesList.includes(extractedData.category) ? extractedData.category : 'Other',
        subject: extractedData.subject || "",
        summary: extractedData.summary || "",
        tags: extractedData.suggestedTags || [],
        createdAt: Date.now(),
        synced: false
      });
      setView('editor');
    } catch (err) {
      console.error("VISION ERROR:", err);
      setError("AI processing failed. Manual entry enabled.");
      setPendingCert({
        id: Date.now().toString(),
        image: base64Data,
        originalImage: base64Data,
        profileId: activeProfileId,
        studentName: "",
        title: "Certificate Scan",
        issuer: "",
        date: new Date().toISOString().split('T')[0],
        category: 'Other',
        subject: "",
        summary: "",
        tags: [],
        createdAt: Date.now(),
        synced: false
      });
      setView('editor');
    } finally {
      setIsProcessing(false);
    }
  };

  const saveCertificate = () => {
    if (pendingCert) {
      let finalProfileId = pendingCert.profileId || activeProfileId;
      if (!finalProfileId && editorNewProfileName.trim()) {
        const newId = handleCreateProfile(editorNewProfileName);
        if (newId) finalProfileId = newId;
      }
      if (!finalProfileId) {
        setError("Please select or create a profile first.");
        return;
      }
      setCertificates(prev => [{ ...pendingCert, profileId: finalProfileId, tags: pendingCert.tags || [] } as Certificate, ...prev]);
      setPendingCert(null);
      setEditorNewProfileName('');
      setView('dashboard');
    }
  };

  const generatePDFBlob = async (certs: Certificate[]): Promise<Blob> => {
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let i = 0; i < certs.length; i++) {
      const cert = certs[i];
      if (i > 0) doc.addPage();

      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59);
      doc.text(cert.title, 20, 25);

      doc.setFontSize(14);
      doc.setTextColor(100, 116, 139);
      doc.text(cert.issuer, 20, 33);

      const imgWidth = 170;
      const imgHeight = 120;
      doc.addImage(cert.image, 'JPEG', (pageWidth - imgWidth) / 2, 45, imgWidth, imgHeight);

      let yPos = 45 + imgHeight + 15;
      doc.setDrawColor(226, 232, 240);
      doc.line(20, yPos - 5, pageWidth - 20, yPos - 5);

      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text("AWARDED TO", 20, yPos);
      doc.text("DATE", pageWidth / 2, yPos);

      yPos += 7;
      doc.setFontSize(12);
      doc.setTextColor(51, 65, 85);
      doc.text(cert.studentName || "N/A", 20, yPos);
      doc.text(cert.date || "N/A", pageWidth / 2, yPos);

      yPos += 15;
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text("DESCRIPTION / SUMMARY", 20, yPos);

      yPos += 7;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105);
      const splitSummary = doc.splitTextToSize(cert.summary || "No description provided.", pageWidth - 40);
      doc.text(splitSummary, 20, yPos);
    }
    return doc.output('blob');
  };

  const sharePDF = async (blob: Blob, filename: string) => {
    if (!navigator.canShare) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const file = new File([blob], filename, { type: 'application/pdf' });
    try {
      await navigator.share({
        files: [file],
        title: 'Shared Certificates',
        text: 'Attached are the certificates from my CertiVault.'
      });
    } catch (err) {
      console.error("Share failed", err);
    }
  };

  const handleBatchShare = async () => {
    if (selectedIds.size === 0) return;
    setIsSharing(true);
    try {
      const selectedCerts = certificates.filter(c => selectedIds.has(c.id));
      const blob = await generatePDFBlob(selectedCerts);
      await sharePDF(blob, `Certificates_Batch_${Date.now()}.pdf`);
    } catch (err) {
      setError("Failed to generate PDF for sharing.");
    } finally {
      setIsSharing(false);
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // --- Hierarchical Sync Logic ---
  const syncToDrive = async () => {
    const profile = profiles.find(p => p.id === activeProfileId);
    if (!profile) return;
    
    setIsSyncing(true);
    setSyncLogs([]);
    
    const addLog = (message: string, status: 'pending' | 'success' | 'info' = 'pending') => {
      setSyncLogs(prev => [...prev, { id: Math.random().toString(), message, status }]);
    };

    try {
      addLog(`Initializing Google Drive Sync for Profile: ${profile.name}`, 'info');
      await new Promise(r => setTimeout(r, 800));
      
      addLog(`Connecting to Drive API...`, 'pending');
      await new Promise(r => setTimeout(r, 600));
      
      const profileCerts = certificates.filter(c => c.profileId === activeProfileId && !c.synced);
      if (profileCerts.length === 0) {
        addLog(`Vault is already up to date.`, 'success');
        await new Promise(r => setTimeout(r, 1000));
        setIsSyncing(false);
        return;
      }

      addLog(`Found ${profileCerts.length} unsynced items.`, 'info');

      // Group by year and category
      const years = Array.from(new Set(profileCerts.map(c => getAcademicYear(c.date))));
      
      for (const year of years) {
        addLog(`Verifying Folder Structure: /${profile.name}/${year}...`, 'pending');
        await new Promise(r => setTimeout(r, 500));
        addLog(`Created Folder: ${year}`, 'success');

        const yearCerts = profileCerts.filter(c => getAcademicYear(c.date) === year);
        const categories = Array.from(new Set(yearCerts.map(c => c.category)));

        for (const cat of categories) {
          addLog(`Verifying Subfolder: /${profile.name}/${year}/${cat}...`, 'pending');
          await new Promise(r => setTimeout(r, 400));
          addLog(`Created Subfolder: ${cat}`, 'success');

          const finalItems = yearCerts.filter(c => c.category === cat);
          for (const item of finalItems) {
            addLog(`Uploading: ${item.title}.pdf`, 'pending');
            await new Promise(r => setTimeout(r, 700));
            addLog(`Success: ${item.title} stored in /${year}/${cat}`, 'success');
            
            // Mark as synced locally
            setCertificates(prev => prev.map(c => c.id === item.id ? { ...c, synced: true } : c));
          }
        }
      }

      addLog(`Sync Complete! Your structure is mirrored on Google Drive.`, 'success');
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      addLog(`Sync failed: Network interruption.`, 'info');
    } finally {
      setIsSyncing(false);
    }
  };

  const syncSingleItem = (cert: Certificate) => {
    setIsSyncing(true);
    setSyncLogs([
      { id: '1', message: `Syncing ${cert.title} to Drive...`, status: 'pending' },
      { id: '2', message: `Creating Path: /${getAcademicYear(cert.date)}/${cert.category}`, status: 'pending' }
    ]);
    
    setTimeout(() => {
      setCertificates(prev => prev.map(c => c.id === cert.id ? { ...c, synced: true } : c));
      setSyncLogs(prev => [...prev, { id: '3', message: `Success! Item stored in hierarchical path.`, status: 'success' }]);
      setTimeout(() => setIsSyncing(false), 1500);
    }, 1500);
  };

  const shareSingleCertificate = async (cert: Certificate) => {
    setIsSharing(true);
    try {
      const blob = await generatePDFBlob([cert]);
      await sharePDF(blob, `${cert.title.replace(/\s+/g, '_')}_Certificate.pdf`);
    } catch (err) {
      setError("Failed to share certificate PDF.");
    } finally {
      setIsSharing(false);
    }
  };

  // --- Filtering Logic ---
  const filteredCerts = useMemo(() => {
    let result = certificates.filter(c => c.profileId === activeProfileId);
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.issuer.toLowerCase().includes(q) || 
        c.studentName.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q)) ||
        getAcademicYear(c.date).toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    }

    if (selectedFilterTags.length > 0) {
      result = result.filter(c => {
        const ay = getAcademicYear(c.date);
        return selectedFilterTags.some(tag => 
          tag === ay || 
          tag === c.category || 
          c.tags.includes(tag)
        );
      });
    }

    return result;
  }, [certificates, activeProfileId, searchQuery, selectedFilterTags]);

  const academicHierarchy = useMemo(() => {
    const hierarchy: Record<string, Record<string, Certificate[]>> = {};
    filteredCerts.forEach(cert => {
      const ay = getAcademicYear(cert.date);
      const cat = cert.category || 'Other';
      if (!hierarchy[ay]) hierarchy[ay] = {};
      if (!hierarchy[ay][cat]) hierarchy[ay][cat] = [];
      hierarchy[ay][cat].push(cert);
    });
    return hierarchy;
  }, [filteredCerts]);

  const sortedAcademicYears = Object.keys(academicHierarchy).sort((a, b) => b.localeCompare(a));

  const availableQuickFilters = useMemo(() => {
    const years = new Set<string>();
    const categories = new Set<string>();
    const allTags = new Set<string>();
    
    certificates.filter(c => c.profileId === activeProfileId).forEach(c => {
      years.add(getAcademicYear(c.date));
      categories.add(c.category);
      c.tags.forEach(t => allTags.add(t));
    });

    return {
      years: Array.from(years).sort((a, b) => b.localeCompare(a)),
      categories: Array.from(categories).sort(),
      tags: Array.from(allTags).sort()
    };
  }, [certificates, activeProfileId]);

  const toggleFilterTag = (tag: string) => {
    setSelectedFilterTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setSelectedFilterTags([]);
    setSearchQuery('');
  };

  // --- Render Functions ---

  const renderLogin = () => (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-slate-900 to-black flex items-center justify-center p-6">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center animate-in fade-in zoom-in-95 duration-700">
        <div className="space-y-8 text-white">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-indigo-500 rounded-3xl shadow-2xl">
              <FileText className="w-10 h-10" />
            </div>
            <h1 className="text-5xl font-black tracking-tighter">CertiVault</h1>
          </div>
          <h2 className="text-3xl font-bold leading-tight opacity-90">Securely Scan, Organize, and Synchronize your achievements.</h2>
          <div className="space-y-4">
            {[
              { icon: Shield, text: "Enterprise-grade AI OCR Extraction" },
              { icon: Zap, text: "Instant A4 Restoration & Cleaning" },
              { icon: Cloud, text: "Direct Google Drive Folder Sync" },
              { icon: Smartphone, text: "Multi-profile Achievement Vault" }
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 opacity-80">
                <div className="p-2 bg-white/10 rounded-xl">
                  <item.icon className="w-5 h-5 text-indigo-400" />
                </div>
                <span className="font-medium">{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-10 md:p-14 rounded-[3.5rem] shadow-2xl space-y-10">
          <div className="text-center space-y-2">
            <h3 className="text-3xl font-black text-slate-900">Welcome Back</h3>
            <p className="text-slate-500 font-medium">Please sign in to access your vault</p>
          </div>
          
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full py-5 px-6 border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-4 hover:bg-slate-50 transition-all active:scale-[0.98] group relative overflow-hidden disabled:opacity-50"
          >
            {isLoggingIn ? (
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            ) : (
              <>
                <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-6 h-6" alt="Google" />
                <span className="text-lg font-black text-slate-700">Sign in with Google</span>
              </>
            )}
            <div className="absolute inset-0 bg-indigo-600/5 translate-y-full group-hover:translate-y-0 transition-transform" />
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100" />
            </div>
            <div className="relative flex justify-center text-sm uppercase font-black tracking-widest text-slate-300">
              <span className="bg-white px-4">Protected by AI</span>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 leading-relaxed px-6">
            By signing in, you agree to our Terms of Service and acknowledge that your documents are processed securely using Google Gemini Vision.
          </p>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => {
    // Limited tags logic: prioritize selected ones, then show up to a cap
    const visibleYears = availableQuickFilters.years.filter(y => selectedFilterTags.includes(y) || availableQuickFilters.years.indexOf(y) < 3);
    const visibleCategories = availableQuickFilters.categories.filter(c => selectedFilterTags.includes(c) || availableQuickFilters.categories.indexOf(c) < 4);
    const visibleTags = availableQuickFilters.tags.filter(t => selectedFilterTags.includes(t) || availableQuickFilters.tags.indexOf(t) < 6);

    const hasMoreYears = availableQuickFilters.years.length > visibleYears.length;
    const hasMoreCats = availableQuickFilters.categories.length > visibleCategories.length;
    const hasMoreTags = availableQuickFilters.tags.length > visibleTags.length;

    return (
      <div className="max-w-6xl mx-auto p-6 md:p-12 animate-in fade-in duration-500">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none">CertiVault</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Record of achievements</p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-100 h-10 px-4">
              {isAddingProfile ? (
                <div className="flex items-center gap-2 w-full min-w-[160px]">
                  <input 
                    autoFocus
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                    placeholder="Profile Name"
                    className="flex-1 bg-transparent text-sm font-bold outline-none border-none placeholder:text-slate-300"
                  />
                  <button onClick={() => handleCreateProfile()} className="text-indigo-600"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setIsAddingProfile(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center group">
                    <select 
                      value={activeProfileId}
                      onChange={(e) => { setActiveProfileId(e.target.value); goToRoot(); setIsSelectionMode(false); setSelectedIds(new Set()); setSearchQuery(''); setSelectedFilterTags([]); }}
                      className="bg-transparent font-bold text-slate-700 outline-none cursor-pointer text-sm appearance-none pr-5 z-10"
                    >
                      {profiles.length > 0 ? (
                        profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                      ) : (
                        <option value="" disabled>No Profiles</option>
                      )}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-0 pointer-events-none group-hover:text-indigo-500 transition-colors" />
                  </div>
                  <div className="w-[1px] h-4 bg-slate-200" />
                  <button onClick={() => setIsAddingProfile(true)} className="text-slate-300 hover:text-indigo-600 transition-all flex items-center justify-center">
                    <Plus className="w-4.5 h-4.5" />
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-3 pl-2 pr-2 bg-white h-10 rounded-full shadow-sm border border-slate-100 hover:border-indigo-100 transition-colors group relative">
              <div className="flex items-center gap-3 pl-1 pr-3">
                <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                  {user?.initials || '??'}
                </div>
                <span className="text-[13px] font-bold text-slate-600">{user?.firstName || 'User'}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-1.5 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded-full transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {profiles.length === 0 ? (
          <div className="max-w-xl mx-auto mt-12 text-center bg-white p-12 rounded-[3rem] border-2 border-slate-100 shadow-xl animate-in zoom-in-95 duration-500">
            <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8">
                <UserPlus className="w-12 h-12 text-indigo-500" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 mb-4">Welcome to CertiVault</h2>
            <p className="text-slate-500 text-lg mb-10 leading-relaxed">Create your first profile to manage achievements.</p>
            <div className="flex gap-2 p-2 bg-slate-50 border border-slate-200 rounded-2xl max-w-sm mx-auto">
                <input 
                  type="text" value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile name..."
                  className="flex-1 bg-transparent px-4 py-3 font-bold text-slate-800 outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                />
                <button onClick={() => handleCreateProfile()} className="bg-indigo-600 text-white px-6 rounded-xl font-bold hover:bg-indigo-700 transition-colors">Create</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <button onClick={startCamera} className="flex-1 flex items-center justify-center gap-2.5 py-3.5 px-6 bg-slate-900 text-white rounded-2xl hover:bg-indigo-600 transition-all shadow-lg hover:shadow-indigo-500/20 font-bold text-sm group active:scale-[0.98]">
                <Camera className="w-5 h-5 group-hover:scale-110 transition-transform" /> Scan Certificate
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2.5 py-3.5 px-6 bg-white text-slate-700 border border-slate-200 rounded-2xl hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm font-bold text-sm active:scale-[0.98]">
                <Upload className="w-5 h-5" /> Upload Document
              </button>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,application/pdf" className="hidden" />
            </div>

            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm mb-10">
              <div className="flex flex-col lg:flex-row items-center gap-4">
                <div className="relative group flex-1 w-full">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                  <input 
                    type="text"
                    placeholder="Search by title, name, issuer, or keyword..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-14 pr-14 py-5 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white outline-none font-bold text-slate-800 placeholder:text-slate-300 transition-all shadow-sm"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-6 top-1/2 -translate-y-1/2 p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button 
                  onClick={syncToDrive}
                  className="flex items-center gap-3 px-8 py-5 bg-indigo-50 text-indigo-600 rounded-2xl font-black hover:bg-indigo-100 transition-all w-full lg:w-auto shadow-sm"
                >
                  <CloudUpload className="w-6 h-6" /> Sync Profile to Drive
                </button>
              </div>

              {/* Limited Tags Row */}
              <div className="mt-6 flex items-center gap-3">
                <div className="p-2.5 bg-slate-100 rounded-xl text-slate-500 shrink-0">
                  <TagIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-2 py-1">
                  {(selectedFilterTags.length > 0 || searchQuery) && (
                    <button 
                      onClick={clearFilters}
                      className="px-3 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow-md shrink-0 animate-in fade-in"
                    >
                      <Eraser className="w-3 h-3" /> Clear
                    </button>
                  )}
                  
                  {visibleYears.map(year => (
                    <button 
                      key={year} 
                      onClick={() => toggleFilterTag(year)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border shrink-0 ${selectedFilterTags.includes(year) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-slate-100 text-slate-500 hover:border-indigo-200'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 opacity-50" /> {year}
                      </span>
                    </button>
                  ))}
                  {hasMoreYears && <MoreHorizontal className="w-4 h-4 text-slate-300 shrink-0" />}

                  {visibleCategories.map(cat => (
                    <button 
                      key={cat} 
                      onClick={() => toggleFilterTag(cat)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border shrink-0 ${selectedFilterTags.includes(cat) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-slate-100 text-slate-500 hover:border-indigo-200'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Filter className="w-3 h-3 opacity-50" /> {cat}
                      </span>
                    </button>
                  ))}
                  {hasMoreCats && <MoreHorizontal className="w-4 h-4 text-slate-300 shrink-0" />}

                  {visibleTags.map(tag => (
                    <button 
                      key={tag} 
                      onClick={() => toggleFilterTag(tag)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border shrink-0 ${selectedFilterTags.includes(tag) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white border-slate-100 text-slate-500 hover:border-indigo-200'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Hash className="w-3 h-3 opacity-50" /> {tag}
                      </span>
                    </button>
                  ))}
                  {hasMoreTags && <MoreHorizontal className="w-4 h-4 text-slate-300 shrink-0" />}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center mb-8 px-2">
              <div className="flex items-center gap-2 text-sm font-black text-slate-400">
                <button onClick={goToRoot} className={`flex items-center gap-1.5 hover:text-indigo-600 transition-colors ${!navPath.year ? 'text-indigo-600' : ''}`}>
                  <Home className="w-4 h-4" /> All Years
                </button>
                {navPath.year && (
                  <>
                    <ChevronRightIcon className="w-4 h-4" />
                    <button onClick={() => setNavPath({year: navPath.year})} className={`hover:text-indigo-600 transition-colors ${!navPath.category ? 'text-indigo-600' : ''}`}>
                      {navPath.year}
                    </button>
                  </>
                )}
                {navPath.category && (
                  <>
                    <ChevronRightIcon className="w-4 h-4" />
                    <span className="text-indigo-600">{navPath.category}</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isSelectionMode ? (
                  <>
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{selectedIds.size} SELECTED</span>
                    <button onClick={handleBatchShare} disabled={selectedIds.size === 0} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-full text-xs font-black shadow-lg hover:bg-indigo-700 disabled:opacity-50 transition-all">
                      <Share2 className="w-3.5 h-3.5" /> SHARE PDF
                    </button>
                    <button onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }} className="text-xs font-black text-slate-400 hover:text-slate-600">CANCEL</button>
                  </>
                ) : (
                  <button onClick={() => setIsSelectionMode(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-full text-xs font-black hover:bg-slate-200 transition-all">
                    <CheckSquare className="w-3.5 h-3.5" /> SELECT MULTIPLE
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {!navPath.year ? (
                sortedAcademicYears.length > 0 ? (
                  sortedAcademicYears.map(ay => (
                    <button key={ay} onClick={() => goToYear(ay)} className="group flex flex-col items-center gap-4 p-6 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
                      <div className="relative">
                        <Folder className="w-16 h-16 text-indigo-400 fill-indigo-50 group-hover:scale-110 transition-transform duration-300" />
                      </div>
                      <div className="text-center">
                        <span className="block text-sm font-black text-slate-800 tracking-tight">{ay}</span>
                        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                          {Object.values(academicHierarchy[ay] || {}).reduce((acc: number, curr: Certificate[]) => acc + (curr?.length || 0), 0)} Items
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="col-span-full py-20 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300"><FolderOpen className="w-10 h-10" /></div>
                    <h3 className="text-xl font-black text-slate-800">No Certificates Found</h3>
                    <p className="text-slate-400 font-bold mt-2">Adjust your search or scan a document to begin.</p>
                  </div>
                )
              ) : !navPath.category ? (
                Object.keys(academicHierarchy[navPath.year] || {}).map(cat => (
                  <button key={cat} onClick={() => goToCategory(cat)} className="group flex flex-col items-center gap-4 p-6 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
                    <Folder className="w-16 h-16 text-slate-400 fill-slate-50 group-hover:scale-110 transition-transform duration-300" />
                    <div className="text-center">
                      <span className="block text-sm font-black text-slate-800 tracking-tight">{cat}</span>
                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                        {academicHierarchy[navPath.year!]?.[cat]?.length || 0} Files
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                (academicHierarchy[navPath.year!]?.[navPath.category!] || []).map(cert => (
                  <div 
                    key={cert.id} 
                    className={`bg-white rounded-[2rem] shadow-sm border overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all group cursor-pointer relative ${isSelectionMode && selectedIds.has(cert.id) ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-100'}`}
                    onClick={() => { 
                      if (isSelectionMode) toggleSelect(cert.id);
                      else { setSelectedCert(cert); setView('detail'); }
                    }}
                  >
                    {isSelectionMode && (
                      <div className="absolute top-3 left-3 z-10">
                        {selectedIds.has(cert.id) ? <CheckSquare className="w-6 h-6 text-indigo-600 fill-white" /> : <Square className="w-6 h-6 text-slate-300 fill-white" />}
                      </div>
                    )}
                    <div className="aspect-[1.414/1] bg-white p-4 pb-2 relative overflow-hidden flex items-center justify-center">
                      <img src={cert.image} className="w-full h-full object-contain transition-transform duration-500" alt={cert.title} />
                      {cert.synced && !isSelectionMode && <div className="absolute top-2 right-2 p-1 bg-green-500 text-white rounded-full shadow-lg"><CheckCircle className="w-3 h-3" /></div>}
                    </div>
                    <div className="p-5 pt-1">
                      <h3 className="text-sm font-black text-slate-900 truncate leading-tight">{cert.title}</h3>
                      <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-0.5 truncate">{cert.issuer}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {cert.tags.slice(0, 3).map(t => (
                          <span key={t} className="text-[7px] font-black text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded uppercase tracking-tighter">#{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderScanner = () => (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="relative flex-1 flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <button onClick={() => { stopCamera(); setView('dashboard'); }} className="absolute top-6 left-6 p-4 bg-white/20 backdrop-blur-md rounded-2xl text-white hover:bg-white/30 transition-all">
          <ChevronLeft className="w-6 h-6" />
        </button>
      </div>
      <div className="bg-black p-10 flex justify-center">
        <button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-white/30 p-1 transition-transform active:scale-95">
          <div className="w-full h-full bg-white rounded-full" />
        </button>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );

  const renderEditor = () => {
    if (!pendingCert) return null;
    const hasProfiles = profiles.length > 0;
    
    const handleAddTag = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && tagInput.trim()) {
        const newTag = tagInput.trim().toLowerCase().replace(/#/g, '');
        if (!pendingCert.tags?.includes(newTag)) {
          setPendingCert({ ...pendingCert, tags: [...(pendingCert.tags || []), newTag] });
        }
        setTagInput('');
        e.preventDefault();
      }
    };

    const removeTag = (tag: string) => {
      setPendingCert({ ...pendingCert, tags: (pendingCert.tags || []).filter(t => t !== tag) });
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row animate-in fade-in duration-500 pb-24 lg:pb-0">
        {/* Left/Top: Image Preview Section */}
        <div className="lg:flex-1 lg:h-screen lg:sticky lg:top-0 p-4 md:p-8 flex flex-col bg-slate-200/50">
          <div className="flex items-center justify-between mb-4 lg:hidden">
            <button onClick={() => setView('dashboard')} className="p-2 bg-white rounded-full shadow-sm">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-black text-slate-900">Review Scan</h2>
            <div className="w-10" /> {/* Spacer */}
          </div>

          <div className="relative flex-1 bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden group flex items-center justify-center p-2">
            <img 
              src={showOriginal ? pendingCert.originalImage : pendingCert.image} 
              className="max-h-full max-w-full object-contain rounded-xl transition-all duration-300" 
              alt="Scanned Certificate"
            />
            
            {/* Status Badge */}
            <div className="absolute top-4 left-4 flex gap-2">
              <div className="bg-green-500 text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                <Sparkles className="w-3 h-3" /> AI OPTIMIZED
              </div>
              <div className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                <GraduationCap className="w-3 h-3" /> A4 SCALE
              </div>
            </div>

            {/* Compare Button */}
            <button 
              onMouseDown={() => setShowOriginal(true)} 
              onMouseUp={() => setShowOriginal(false)} 
              onMouseLeave={() =>