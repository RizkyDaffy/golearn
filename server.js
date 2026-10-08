const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const QUESTIONS_DIR = path.join(__dirname, 'questions');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to convert filename (e.g. 'machine_learning' or 'math') to display title
function slugToTitle(slug) {
    return slug
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

// Smart Lucide icon & style mapping for subjects
function getSubjectMeta(id, index) {
    const lower = id.toLowerCase();

    if (lower.includes('math') || lower.includes('calc') || lower.includes('algeb') || lower.includes('geom')) {
        return {
            icon: 'calculator',
            bgColor: 'bg-emerald-100 dark:bg-emerald-950/80',
            iconColor: 'text-emerald-600 dark:text-emerald-400'
        };
    }
    if (lower.includes('mach') || lower.includes('ai') || lower.includes('tech') || lower.includes('robot') || lower.includes('eng')) {
        return {
            icon: 'cpu',
            bgColor: 'bg-amber-100 dark:bg-amber-950/80',
            iconColor: 'text-amber-600 dark:text-amber-400'
        };
    }
    if (lower.includes('code') || lower.includes('prog') || lower.includes('dev') || lower.includes('comp') || lower.includes('cs')) {
        return {
            icon: 'code-2',
            bgColor: 'bg-sky-100 dark:bg-sky-950/80',
            iconColor: 'text-sky-600 dark:text-sky-400'
        };
    }
    if (lower.includes('phys') || lower.includes('sci')) {
        return {
            icon: 'atom',
            bgColor: 'bg-purple-100 dark:bg-purple-950/80',
            iconColor: 'text-purple-600 dark:text-purple-400'
        };
    }
    if (lower.includes('bio') || lower.includes('chem')) {
        return {
            icon: 'flask-conical',
            bgColor: 'bg-rose-100 dark:bg-rose-950/80',
            iconColor: 'text-rose-600 dark:text-rose-400'
        };
    }

    const PALETTE = [
        { icon: 'book-open', bgColor: 'bg-teal-100 dark:bg-teal-950/80', iconColor: 'text-teal-600 dark:text-teal-400' },
        { icon: 'layers', bgColor: 'bg-indigo-100 dark:bg-indigo-950/80', iconColor: 'text-indigo-600 dark:text-indigo-400' },
        { icon: 'globe', bgColor: 'bg-blue-100 dark:bg-blue-950/80', iconColor: 'text-blue-600 dark:text-blue-400' },
        { icon: 'sparkles', bgColor: 'bg-violet-100 dark:bg-violet-950/80', iconColor: 'text-violet-600 dark:text-violet-400' },
    ];
    return PALETTE[index % PALETTE.length];
}

/**
 * GET /api/subjects
 * Dynamically scans the /questions folder for all .json files.
 * Derives subject title from the filename and computes question counts.
 */
app.get('/api/subjects', async (req, res) => {
    try {
        if (!fs.existsSync(QUESTIONS_DIR)) {
            return res.json({ subjects: [] });
        }

        const files = await fs.promises.readdir(QUESTIONS_DIR);
        // Exclude manifest.json or non-json files
        const jsonFiles = files.filter(f => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'manifest.json');

        const subjects = [];

        for (let i = 0; i < jsonFiles.length; i++) {
            const file = jsonFiles[i];
            const id = path.basename(file, '.json');
            const filePath = path.join(QUESTIONS_DIR, file);

            try {
                const rawContent = await fs.promises.readFile(filePath, 'utf-8');
                const questions = JSON.parse(rawContent);
                const safeQuestions = Array.isArray(questions) ? questions : [];

                const pilganCount = safeQuestions.filter(q => q.tipe_soal === 'PILGAN').length;
                const essayCount = safeQuestions.filter(q => q.tipe_soal === 'ESSAY').length;

                const meta = getSubjectMeta(id, i);

                subjects.push({
                    id,
                    title: slugToTitle(id),
                    filename: file,
                    count: safeQuestions.length,
                    description: `${pilganCount} multiple choice · ${essayCount} essay`,
                    icon: meta.icon,
                    bgColor: meta.bgColor,
                    iconColor: meta.iconColor,
                    questions: safeQuestions
                });
            } catch (err) {
                console.error(`Error reading ${file}:`, err.message);
            }
        }

        res.json({ subjects });
    } catch (err) {
        console.error('Error scanning subjects:', err);
        res.status(500).json({ error: 'Failed to load subjects' });
    }
});

/**
 * GET /api/questions/:id
 * Returns the raw questions array for a specific subject ID.
 */
app.get('/api/questions/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const filePath = path.join(QUESTIONS_DIR, `${id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `Subject ${id} not found` });
        }

        const rawContent = await fs.promises.readFile(filePath, 'utf-8');
        const questions = JSON.parse(rawContent);
        res.json(questions);
    } catch (err) {
        console.error(`Error fetching questions for ${req.params.id}:`, err);
        res.status(500).json({ error: 'Failed to read questions' });
    }
});

// Register /view/list and /view/:name endpoints
const { registerViewRoutes } = require('./viewRoutes');
registerViewRoutes(app, QUESTIONS_DIR);

// Serve frontend static files
app.use(express.static(__dirname));

// Fallback to index.html for SPA navigation
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Bind to 0.0.0.0 so the app is reachable from Railway / containers.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Golearn Express Server running on port ${PORT}`);
    console.log(`📁 Scanning subjects from: ${QUESTIONS_DIR}`);
});
