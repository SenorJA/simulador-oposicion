export const state = {
    allQuestions: [],
    currentQuestions: [],
    currentIndex: 0,
    score: 0,
    userAnswers: {},
    currentMode: 'training', // 'training', 'exam', 'failures', 'review'
    originalMode: 'training',
    currentRole: 'pinche',
    currentSource: null,
    currentCategory: null,
    currentTopicName: "",
    currentTestId: null,    // ID único del test activo para récords
    pendingTestId: null,    // ID temporal del test seleccionado
    lastViewBeforeMode: 'menu',
    supabaseClient: null,
    timeRemaining: 0,       // Segundos restantes del cronómetro
    timerInterval: null,    // Referencia al setInterval activo
    viewHistory: [],        // Historial de navegación por vistas
    timerEnabled: true,     // Si el cronómetro de examen está activo
    timeElapsed: 0          // Segundos transcurridos (si el timer está desactivado)
};

export function resetGameState() {
    state.currentIndex = 0;
    state.score = 0;
    state.userAnswers = {};
    state.timeRemaining = 0;
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}
