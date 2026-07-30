/**
 * dictionary.js
 * Handles word validation by maintaining a JavaScript Set of valid words.
 * Loads wordlist.txt and falls back to a built-in common wordlist if fetch fails.
 */

class WordValidator {
    constructor() {
        this.words = new Set();
        this.loaded = false;
        
        // Built-in fallback word list (~350 common words)
        // Ensures the game works even if opened via file:// protocol (CORS blocks local fetch)
        this.fallbackWords = [
            "the", "and", "you", "that", "was", "for", "are", "with", "his", "they", "this", "have", "from", 
            "one", "had", "word", "but", "not", "what", "all", "were", "when", "your", "can", "said", "there", 
            "use", "each", "which", "she", "how", "their", "will", "other", "about", "out", "many", "then", 
            "them", "these", "so", "some", "her", "would", "make", "like", "him", "into", "time", "has", 
            "look", "two", "more", "write", "go", "see", "number", "no", "way", "could", "people", "my", 
            "than", "first", "water", "been", "call", "who", "oil", "its", "now", "find", "long", "down", 
            "day", "did", "get", "come", "made", "may", "part", "over", "new", "sound", "take", "only", 
            "little", "work", "know", "place", "year", "live", "me", "back", "give", "most", "very", "after", 
            "thing", "our", "just", "name", "good", "sentence", "man", "think", "say", "great", "where", 
            "help", "through", "much", "before", "line", "right", "too", "mean", "any", "same", "tell", 
            "boy", "follow", "came", "want", "show", "also", "around", "form", "three", "small", "set", 
            "put", "end", "does", "another", "well", "large", "must", "big", "even", "such", "because", 
            "turn", "here", "why", "ask", "went", "men", "read", "need", "land", "different", "home", 
            "us", "move", "try", "kind", "hand", "picture", "again", "change", "off", "play", "spell", 
            "air", "away", "animal", "house", "point", "page", "letter", "mother", "answer", "found", 
            "study", "still", "learn", "should", "america", "world", "high", "every", "near", "add", 
            "food", "between", "own", "below", "country", "plant", "last", "school", "father", "keep", 
            "tree", "never", "start", "city", "earth", "eye", "light", "thought", "head", "under", "story", 
            "saw", "left", "don", "few", "while", "along", "might", "close", "something", "seem", "next", 
            "hard", "open", "example", "begin", "life", "always", "those", "both", "paper", "together", 
            "got", "group", "often", "run", "important", "until", "children", "side", "feet", "car", 
            "mile", "night", "walk", "white", "sea", "began", "grow", "took", "river", "four", "carry", 
            "state", "once", "book", "hear", "stop", "without", "second", "late", "miss", "idea", "enough", 
            "eat", "face", "watch", "far", "really", "almost", "let", "above", "girl", "sometimes", 
            "mountain", "cut", "young", "talk", "soon", "list", "song", "being", "leave", "family", "it",
            "is", "at", "on", "he", "as", "by", "or", "an", "if", "in", "to", "of", "up", "so", "am",
            "cat", "dog", "rat", "bat", "pig", "cow", "hen", "fox", "owl", "run", "jump", "hop", "box",
            "top", "red", "blue", "gold", "cyan", "drop", "game", "grid", "tile", "neon", "cool", "code",
            "bomb", "swap", "hint", "fast", "slow", "rise", "word", "row", "col", "play", "test", "demo"
        ];
    }

    async init() {
        console.log("Dictionary: Initializing word validator...");
        try {
            // Attempt to fetch wordlist.txt with cache-busting
            const response = await fetch("wordlist.txt?v=" + Date.now());
            if (!response.ok) {
                throw new Error(`Failed to load wordlist.txt: status ${response.status}`);
            }
            
            const text = await response.text();
            // Split by any newline format
            const list = text.split(/\r?\n/);
            
            let count = 0;
            for (let word of list) {
                let clean = word.trim().toLowerCase();
                // We only permit English alphabet words of length >= 3
                if (clean.length >= 3 && /^[a-z]+$/.test(clean)) {
                    this.words.add(clean);
                    count++;
                }
            }
            
            // Add fallback words too just to be comprehensive
            this.fallbackWords.forEach(w => {
                if (w.length >= 3) this.words.add(w.toLowerCase());
            });

            console.log(`Dictionary: Loaded ${this.words.size} unique words successfully from server.`);
            this.loaded = true;
        } catch (err) {
            console.warn("Dictionary: Fetch failed, using built-in fallback word list. Details:", err.message);
            // Load fallbacks
            this.fallbackWords.forEach(w => {
                let clean = w.trim().toLowerCase();
                if (clean.length >= 3 && /^[a-z]+$/.test(clean)) {
                    this.words.add(clean);
                }
            });
            console.log(`Dictionary: Loaded ${this.words.size} fallback words.`);
            this.loaded = true;
        }
    }

    isValidWord(word) {
        if (!word) return false;
        return this.words.has(word.toLowerCase().trim());
    }
}

export const validator = new WordValidator();
