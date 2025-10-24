// Global theme store using Svelte 5 runes with SSR support
import { getContext, setContext } from 'svelte';

const THEME_CONTEXT_KEY = 'theme-context';

interface ThemeContext {
	theme: 'light' | 'dark';
	setTheme: (theme: 'light' | 'dark') => void;
	toggleTheme: () => void;
}

// Create the theme store with initial value from server
export function createThemeStore(initialTheme: 'light' | 'dark' = 'light') {
	let currentTheme = $state<'light' | 'dark'>(initialTheme);

	function setTheme(newTheme: 'light' | 'dark') {
		currentTheme = newTheme;

		if (typeof window !== 'undefined') {
			// Update DOM
			if (newTheme === 'dark') {
				document.documentElement.setAttribute('data-theme', 'dark');
			} else {
				document.documentElement.removeAttribute('data-theme');
			}

			// Update cookie (with SameSite and path)
			document.cookie = `theme=${newTheme}; path=/; max-age=31536000; SameSite=Lax`;

			// Also update localStorage as fallback
			localStorage.setItem('theme', newTheme);
		}
	}

	function toggleTheme() {
		setTheme(currentTheme === 'light' ? 'dark' : 'light');
	}

	const store: ThemeContext = {
		get theme() {
			return currentTheme;
		},
		setTheme,
		toggleTheme
	};

	// Set in context for child components
	setContext(THEME_CONTEXT_KEY, store);

	return store;
}

// Get theme store from context
export function useTheme(): ThemeContext {
	const context = getContext<ThemeContext | undefined>(THEME_CONTEXT_KEY);

	if (!context) {
		// Fallback for components not under theme provider
		// This creates a local store instance
		let localTheme = $state<'light' | 'dark'>('light');
		let initialized = false;

		function initTheme() {
			if (!initialized && typeof window !== 'undefined') {
				initialized = true;
				// Try to get theme from cookie or localStorage
				const cookieTheme = document.cookie
					.split('; ')
					.find((row) => row.startsWith('theme='))
					?.split('=')[1] as 'light' | 'dark' | undefined;

				const storedTheme =
					cookieTheme || (localStorage.getItem('theme') as 'light' | 'dark' | null);

				if (storedTheme === 'dark' || storedTheme === 'light') {
					localTheme = storedTheme;
				} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
					localTheme = 'dark';
				}

				// Apply theme
				if (localTheme === 'dark') {
					document.documentElement.setAttribute('data-theme', 'dark');
				}
			}
		}

		// Initialize on first call
		if (typeof window !== 'undefined') {
			initTheme();
		}

		return {
			get theme() {
				return localTheme;
			},
			setTheme: (newTheme: 'light' | 'dark') => {
				localTheme = newTheme;
				if (typeof window !== 'undefined') {
					if (newTheme === 'dark') {
						document.documentElement.setAttribute('data-theme', 'dark');
					} else {
						document.documentElement.removeAttribute('data-theme');
					}
					document.cookie = `theme=${newTheme}; path=/; max-age=31536000; SameSite=Lax`;
					localStorage.setItem('theme', newTheme);
				}
			},
			toggleTheme: () => {
				const newTheme = localTheme === 'light' ? 'dark' : 'light';
				localTheme = newTheme;
				if (typeof window !== 'undefined') {
					if (newTheme === 'dark') {
						document.documentElement.setAttribute('data-theme', 'dark');
					} else {
						document.documentElement.removeAttribute('data-theme');
					}
					document.cookie = `theme=${newTheme}; path=/; max-age=31536000; SameSite=Lax`;
					localStorage.setItem('theme', newTheme);
				}
			}
		};
	}

	return context;
}
