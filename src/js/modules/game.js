/**
 * game.js — Game engine: renders questions, handles answers, navigation, results.
 * Ported from script.js and adapted as an ES Module.
 */
import { state, resetGameState } from './state.js';
import { showView, toggleEl, updateFailureBadge } from './ui.js';
import * as Storage from './storage.js';

// ── Timer helpers ─────────────────────────────────────────────────────────────

/**
 * Formatea segundos → 'MM:SS'.
 */
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Actualiza el badge del cronómetro en la UI.
 */
function updateTimerUI() {
    const el = document.getElementById('game-timer');
    if (!el) return;

    if (state.timerEnabled) {
        const secs = state.timeRemaining;
        el.textContent = `⏱️ ${formatTime(secs)}`;
        el.classList.toggle('warning', secs > 0 && secs <= 300);  // ≤ 5 min
        el.classList.toggle('urgent',  secs > 0 && secs <= 60);   // ≤ 1 min
    } else {
        const secs = state.timeElapsed || 0;
        el.textContent = `⏱️ ${formatTime(secs)}`;
        el.classList.remove('warning', 'urgent');
    }
}

/**
 * Inicia el cronómetro inverso para el modo examen.
 * @param {number} seconds  Tiempo inicial en segundos.
 */
export function startTimer(seconds) {
    stopTimer(); // Limpia cualquier timer previo
    state.timeRemaining = seconds;

    const el = document.getElementById('game-timer');
    if (el) el.classList.remove('hidden');
    updateTimerUI();

    state.timerInterval = setInterval(() => {
        // Only decrement if timer is enabled
        if (state.timerEnabled) {
            state.timeRemaining--;
            updateTimerUI();

            if (state.timeRemaining <= 0) {
                stopTimer();
                alert('⏰ ¡Tiempo agotado! El examen se ha finalizado automáticamente.');
                finishGame();
            }
        } else {
            // If disabled, we could count UP (optional) or just do nothing.
            // Requirement says "clock doesn't appear or counts up without limit".
            // Let's count up for review/informational purposes if enabled.
            state.timeElapsed = (state.timeElapsed || 0) + 1;
            updateTimerUI();
        }

        // Persistir cada 5 s (no en cada tick) para no serializar todo el test cada segundo
        const secs = state.timerEnabled ? state.timeRemaining : state.timeElapsed;
        if (secs % 5 === 0) saveCurrentSession();
    }, 1000);
}

/**
 * Detiene el cronómetro y oculta el badge de la UI.
 */
export function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
    const el = document.getElementById('game-timer');
    if (el) {
        el.classList.add('hidden');
        el.classList.remove('warning', 'urgent');
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a game session.
 * @param {Array}  questions     The question set to play.
 * @param {string} mode          'training' | 'exam' | 'failures' | 'review'
 * @param {string} topicName     Display name for the session.
 * @param {string} testId        Unique ID for records.
 * @param {number} customSeconds Optional custom time in seconds.
 */
export function startGame(questions, mode, topicName, testId = null, customSeconds = null) {
    if (!questions || questions.length === 0) {
        alert('No hay preguntas para iniciar este test.');
        return;
    }

    // ── Reset de la vista completa (por si el test anterior acabó con ella activa,
    //    p.ej. al agotarse el tiempo estando en full view) ──
    resetFullView();

    // ── Auto-limpieza: si había un test en pausa, se descarta al iniciar uno nuevo ──
    if (mode !== 'review') {
        Storage.clearSuspendedSession();
    }

    state.currentQuestions = questions;
    state.currentMode = mode;
    state.currentTopicName = topicName;
    state.currentTestId = testId;
    resetGameState();

    if (mode !== 'review') state.originalMode = mode;

    // Show / hide the "Vaciar Fallos" button in the game header
    toggleEl('btn-clear-failures-header', mode === 'failures');

    // ── Iniciar cronómetro solo en modo Examen ──
    if (mode === 'exam') {
        const seconds = customSeconds || (questions.length * 60); // 1 minuto por pregunta si no se indica
        startTimer(seconds);
        
        // If timer is disabled, hide it or change its behavior
        const el = document.getElementById('game-timer');
        if (el && !state.timerEnabled) {
            el.textContent = "⏱️ Sin límite";
            el.classList.remove('warning', 'urgent');
        }
    } else {
        stopTimer();
    }

    showView('game');
    renderQuestion();
    saveCurrentSession();
}

/**
 * Initialise a review session from the results screen.
 * @param {boolean} onlyFailures  true = show only wrong/unanswered.
 */
export function startReviewMode(onlyFailures = false) {
    let questions = state.currentQuestions;
    let answersSnap = { ...state.userAnswers };
    const topicName = state.currentTopicName;

    if (onlyFailures) {
        const idxToKeep = questions
            .map((_q, i) => i)
            .filter(i => {
                const ans = state.userAnswers[i];
                if (!ans) return false;  // skip blancs — only answered-wrong count as fallos
                const question = questions[i];
                return ans.toLowerCase() !== (question.correcta || '').toLowerCase();
            });

        if (idxToKeep.length === 0) {
            alert('¡No tienes fallos para revisar! 🏆');
            return;
        }

        const newAnswers = {};
        idxToKeep.forEach((oldIdx, newIdx) => {
            if (state.userAnswers[oldIdx]) newAnswers[newIdx] = state.userAnswers[oldIdx];
        });

        questions = idxToKeep.map(i => state.currentQuestions[i]);
        answersSnap = newAnswers;
    }

    startGame(questions, 'review', topicName + (onlyFailures ? ' (Solo Fallos)' : ' (Completo)'));

    // Restore the saved answers so user sees their previous choices
    state.userAnswers = answersSnap;
    renderQuestion();
}

// ── Navigation handlers (called from main.js event listeners) ─────────────────

export function nextQuestion() {
    if (state.currentIndex < state.currentQuestions.length - 1) {
        state.currentIndex++;
        renderQuestion();
        saveCurrentSession();
    } else {
        if (state.currentMode === 'review') {
            showView('results');
        } else {
            try {
                finishGame();
            } catch (err) {
                console.error('Error finishing game from nextQuestion:', err);
                alert('Error al finalizar el examen. Por favor intenta de nuevo.');
            }
        }
    }
}

export function prevQuestion() {
    if (state.currentIndex > 0) {
        state.currentIndex--;
        renderQuestion();
        saveCurrentSession();
    }
}

export function showGrid() {
    const container = document.getElementById('grid-buttons');
    const overlay = document.getElementById('nav-grid-overlay');
    document.getElementById('grid-total').textContent = state.currentQuestions.length;
    container.innerHTML = '';

    state.currentQuestions.forEach((q, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn-grid-number';
        btn.textContent = index + 1;

        const answer = state.userAnswers[index];
        if (index === state.currentIndex) btn.classList.add('current');
        if (answer) {
            btn.classList.add('answered');
            if (state.currentMode !== 'exam') {
                const isOk = answer === q.correcta;
                btn.style.backgroundColor = isOk ? 'var(--success)' : 'var(--error)';
                btn.style.color = 'white';
                btn.style.borderColor = isOk ? 'var(--success)' : 'var(--error)';
            }
        }

        btn.addEventListener('click', () => {
            state.currentIndex = index;
            renderQuestion();
            overlay.classList.add('hidden');
            saveCurrentSession();
        });
        container.appendChild(btn);
    });

    overlay.classList.remove('hidden');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function renderQuestion() {
    const q = state.currentQuestions[state.currentIndex];
    const mode = state.currentMode;

    // Counter + progress bar
    document.getElementById('question-counter').textContent =
        `${state.currentIndex + 1}/${state.currentQuestions.length}`;
    document.getElementById('score-badge').textContent =
        mode === 'exam' ? '???' : `Aciertos: ${state.score}`;
    const pct = (state.currentIndex / state.currentQuestions.length) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;

    // Tema tag
    const temaMatch = q?.tema?.match(/Tema \d+/);
    document.getElementById('tema-tag').textContent =
        temaMatch ? temaMatch[0] : (q?.tema || 'General');

    // Mode tag
    const modeTag = document.getElementById('mode-tag');
    const modeStyles = {
        exam: { text: 'Examen', bg: '#ffebee', color: '#c62828' },
        failures: { text: 'Repaso Fallos', bg: '#fff3e0', color: '#ef6c00' },
        review: { text: 'Revisión', bg: '#e3f2fd', color: '#1565c0' },
        training: { text: 'Entrenamiento', bg: '#e8f5e9', color: '#2e7d32' }
    };
    const style = modeStyles[mode] || modeStyles.training;
    modeTag.textContent = style.text;
    modeTag.style.background = style.bg;
    modeTag.style.color = style.color;

    // Prev button: only in exam/review modes
    const btnPrev = document.getElementById('btn-prev');
    btnPrev.classList.toggle('hidden', mode !== 'exam' && mode !== 'review');

    // Question text
    document.getElementById('pregunta-texto').textContent = q.pregunta;

    // Clear feedback
    document.getElementById('feedback').classList.add('hidden');
    document.getElementById('explicacion').innerHTML = '';

    // Next button default
    const btnNext = document.getElementById('btn-next');
    btnNext.classList.add('hidden');
    btnNext.innerHTML = buildNextButtonLabel();

    // Render options
    const optContainer = document.getElementById('opciones-container');
    optContainer.innerHTML = '';
    ['a', 'b', 'c', 'd'].forEach(letter => {
        if (!q.opciones?.[letter]) return;
        const btn = createOptionButton(q, letter);
        optContainer.appendChild(btn);
    });

    // Exam / review / already answered / paused restoration: check visibility
    const alreadyAnswered = state.userAnswers && state.userAnswers[state.currentIndex];
    if (mode === 'exam' || mode === 'review' || alreadyAnswered) {
        btnNext.classList.remove('hidden');
        btnNext.innerHTML = buildNextButtonLabel();
    }
}

function buildNextButtonLabel() {
    const isLast = state.currentIndex === state.currentQuestions.length - 1;
    const mode = state.currentMode;
    if (isLast) {
        if (mode === 'exam') return 'Finalizar Examen 🏁';
        if (mode === 'review') return 'Volver a Resultados 🏁';
        return 'Finalizar Test 🏁';
    }
    return 'Siguiente <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

function createOptionButton(q, letter) {
    const btn = document.createElement('button');
    btn.className = 'btn-option';
    btn.innerHTML = `<strong>${letter.toUpperCase()})</strong> ${q.opciones[letter]}`;

    const answered = state.userAnswers[state.currentIndex];

    if (answered && state.currentMode !== 'exam') {
        // Training/failures: restore locked state with colour feedback
        applyAnswerStyle(btn, letter, q.correcta, answered, state.currentMode);
    } else {
        // Exam mode (even if already answered) OR fresh — allow (re)answering
        if (answered && state.currentMode === 'exam') {
            // Pre-highlight stored selection without locking
            if (letter === answered) {
                btn.style.border = '2px solid var(--primary)';
                btn.style.background = 'rgba(79,70,229,0.12)';
                btn.classList.add('selected');
            }
        }
        btn.addEventListener('click', () => handleAnswer(letter, q));
    }

    return btn;
}

function applyAnswerStyle(btn, letter, correcta, chosen, mode) {
    btn.disabled = true;
    if (mode === 'exam') {
        if (letter === chosen) {
            btn.style.border = '2px solid var(--primary)';
            btn.style.background = '#eef';
            btn.classList.add('selected');
        }
    } else {
        if (letter === correcta) btn.classList.add('correct');
        else if (letter === chosen) btn.classList.add('incorrect');
    }
}

function handleAnswer(selected, q) {
    if (state.currentMode === 'review') return;
    if (state.currentMode !== 'exam' && state.userAnswers[state.currentIndex]) return;

    const isCorrect = selected === q.correcta;
    state.userAnswers[state.currentIndex] = selected;

    // Score + failure tracking
    if (isCorrect) {
        state.score++;
        // BUG FIX: AUTO-PERDÓN
        // Si el usuario ACERTA, eliminamos el ID del histórico de fallos
        Storage.removeFailedId(q.id);
        updateFailureBadge(Storage.getFailedIds().length);
    } else {
        Storage.addFailedId(q.id);
        updateFailureBadge(Storage.getFailedIds().length);
    }

    // Exam mode: highlight selected, keep ALL buttons re-clickable
    const optContainer = document.getElementById('opciones-container');
    const buttons = [...optContainer.children];

    if (state.currentMode === 'exam') {
        buttons.forEach(b => {
            // Reset visual state on all options
            b.style.border = '';
            b.style.background = '';
            b.classList.remove('selected');
            // Highlight only the newly selected one
            const ltr = b.innerHTML.charAt(b.innerHTML.indexOf(')') - 1).toLowerCase();
            if (ltr === selected) {
                b.style.border = '2px solid var(--primary)';
                b.style.background = 'rgba(79,70,229,0.12)';
                b.classList.add('selected');
            }
            // Always re-attach listener so the user can change their answer
            const newBtn = b.cloneNode(true);
            newBtn.style.border = b.style.border;
            newBtn.style.background = b.style.background;
            if (b.classList.contains('selected')) newBtn.classList.add('selected');
            newBtn.addEventListener('click', () => handleAnswer(ltr, q));
            b.replaceWith(newBtn);
        });
    } else {
        // Training / failures: lock and colour
        buttons.forEach(b => {
            b.disabled = true;
            const ltr = b.innerHTML.charAt(b.innerHTML.indexOf(')') - 1).toLowerCase();
            if (ltr === q.correcta) b.classList.add('correct');
            else if (ltr === selected) b.classList.add('incorrect');
        });

        // Show feedback
        const feedbackDiv = document.getElementById('feedback');
        const explicacionP = document.getElementById('explicacion');
        feedbackDiv.classList.remove('hidden');
        if (isCorrect) {
            explicacionP.innerHTML = '<strong>✅ ¡Correcto!</strong>';
            feedbackDiv.style.backgroundColor = '#e8f5e9';
            feedbackDiv.style.borderLeftColor = '#4caf50';
        } else {
            explicacionP.innerHTML = `<strong>❌ Incorrecto</strong><br>La respuesta correcta es la <strong>${q.correcta.toUpperCase()}</strong>.`;
            feedbackDiv.style.backgroundColor = '#ffebee'; /* Light Red background */
            feedbackDiv.style.borderLeftColor = '#b91c1c';   /* Dark Red border */
        }
    }

    // Show / update Next button
    const btnNext = document.getElementById('btn-next');
    btnNext.classList.remove('hidden');
    btnNext.innerHTML = buildNextButtonLabel();
    setTimeout(() => btnNext.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    
    saveCurrentSession();
}

function finishGame() {
    stopTimer(); // Limpiar timer antes de mostrar resultados
    Storage.clearSuspendedSession();
    const total = state.currentQuestions.length;
    let aciertos = 0, fallos = 0, blancos = 0;

    state.currentQuestions.forEach((q, i) => {
        const ans = state.userAnswers[i];
        if (!ans) blancos++;
        else if (ans === q.correcta) aciertos++;
        else fallos++;
    });

    const percentage = Math.round((aciertos / total) * 100);

    // ── Exam: penalised score ──
    if (state.currentMode === 'exam') {
        const rawScore = aciertos - fallos / 3;
        const finalScore = Math.max(0, rawScore);
        const pointsPerQ = 10 / total;
        const notaNumerica = finalScore * pointsPerQ;

        document.getElementById('final-score').textContent = finalScore.toFixed(2);
        document.getElementById('final-total').textContent = `/ ${total} pts`;

        const detailsEl = document.getElementById('exam-feedback-container');
        detailsEl.classList.remove('hidden');
        detailsEl.innerHTML = `
            <div style="background:#f9f9f9;padding:15px;border-radius:8px;border:1px solid #ddd;">
              <h4>📊 Desglose de Puntuación</h4>
              <ul style="list-style:none;padding:0;line-height:1.8;">
                <li>✅ <strong>Aciertos:</strong> ${aciertos}</li>
                <li>❌ <strong>Errores:</strong> ${fallos} <span style="color:red;">(-0.33 c/u)</span></li>
                <li>⚪ <strong>Blancas:</strong> ${blancos}</li>
                <li style="margin-top:8px;border-top:1px solid #ccc;padding-top:6px;">
                    <strong>Puntuación neta:</strong> ${aciertos} - ${(fallos / 3).toFixed(2)} = <strong>${finalScore.toFixed(2)}</strong>
                </li>
                <li style="font-size:1.1em;color:var(--primary);">
                    <strong>Nota Final (0–10): ${notaNumerica.toFixed(2)}</strong>
                </li>
              </ul>
              <p style="font-size:0.85em;color:#777;">* Fórmula oficial: Aciertos − (Errores / 3)</p>
            </div>`;

        Storage.addHistoryEntry({
            date: new Date().toLocaleDateString('es-ES'),
            topic: state.currentTopicName + ' [Examen]',
            score: notaNumerica.toFixed(2),
            total: 10,
            pct: Math.round(notaNumerica * 10)
        });

    } else {
        // ── Training / Failures ──
        document.getElementById('final-score').textContent = aciertos;
        document.getElementById('final-total').textContent = `/ ${total} pts`;
        document.getElementById('exam-feedback-container').classList.add('hidden');

        if (state.currentMode !== 'failures') {
            Storage.addHistoryEntry({
                date: new Date().toLocaleDateString('es-ES'),
                topic: state.currentTopicName + ' [Entrenamiento]',
                score: aciertos,
                total,
                pct: percentage
            });
        }
    }

    // ── Guardar Récord (High Score) ──
    const score0to10 = (state.currentMode === 'exam')
        ? Math.max(0, aciertos - fallos / 3) * (10 / total)
        : (aciertos / total) * 10;

    if (state.currentTestId && state.currentMode !== 'review') {
        const isNewRecord = Storage.saveRecord(state.currentTestId, score0to10);
        if (isNewRecord) {
            console.log(`¡Nuevo récord para ${state.currentTestId}: ${score0to10.toFixed(2)}!`);
        }
    }

    // Motivational feedback
    const pctEl = document.getElementById('resultado-porcentaje');
    const txtEl = document.getElementById('resultado-texto');
    pctEl.textContent = `${percentage}% de Aciertos`;

    // Calculamos la nota sobre 10 oficial (Aciertos - Fallos/3) para el feedback
    const rawScoreFeed = aciertos - (fallos / 3);
    const notaFinalFeed = Math.max(0, rawScoreFeed) * (10 / total);

    // Limpiar colores inline por si existían, para que actúen las clases CSS
    pctEl.style.color = '';
    txtEl.style.color = '';

    if (notaFinalFeed >= 9) {
        pctEl.className = 'texto-exito-teal';
        txtEl.className = 'texto-exito-teal';
        txtEl.textContent = '¡Excelente! Plaza casi asegurada. 🏆';
    } else if (notaFinalFeed >= 7) {
        pctEl.className = 'texto-bien-teal';
        txtEl.className = 'texto-bien-teal';
        txtEl.textContent = '¡Muy buen trabajo! Vas por el buen camino. 🚀';
    } else if (notaFinalFeed >= 5) {
        pctEl.className = 'texto-aviso-naranja';
        txtEl.className = 'texto-aviso-naranja';
        txtEl.textContent = '¡Aprobado! Pero hay margen de mejora, repasa los fallos. 📚';
    } else if (notaFinalFeed >= 3) {
        pctEl.className = 'texto-peligro-rojo';
        txtEl.className = 'texto-peligro-rojo';
        txtEl.textContent = '¡No te rindas! De los errores se aprende. Revisa los fallos. 💪';
    } else {
        pctEl.className = 'texto-peligro-rojo';
        txtEl.className = 'texto-peligro-rojo';
        txtEl.textContent = 'Duro golpe, pero es solo un simulacro. ¡A seguir estudiando! ☕';
    }

    // Review buttons
    const btnReviewAll = document.getElementById('btn-review-exam');
    const btnReviewFailed = document.getElementById('btn-review-failed');

    if (btnReviewAll) {
        btnReviewAll.classList.remove('hidden');
        // Remove old listener before adding new one
        const newBtn = btnReviewAll.cloneNode(true);
        newBtn.addEventListener('click', () => startReviewMode(false));
        btnReviewAll.replaceWith(newBtn);
    }

    if (btnReviewFailed) {
        // startReviewMode(true) solo incluye respuestas falladas (no blancas),
        // así que el botón solo se muestra cuando realmente hay fallos que revisar
        if (fallos > 0) {
            btnReviewFailed.classList.remove('hidden');
            const newBtn = btnReviewFailed.cloneNode(true);
            newBtn.addEventListener('click', () => startReviewMode(true));
            btnReviewFailed.replaceWith(newBtn);
        } else {
            btnReviewFailed.classList.add('hidden');
        }
    }

    // Show "Borrar Fallos" if there are any stored
    const btnClearFail = document.getElementById('btn-clear-failures');
    if (btnClearFail) toggleEl('btn-clear-failures', Storage.getFailedIds().length > 0);

    updateFailureBadge(Storage.getFailedIds().length);
    showView('results');
}

export function saveCurrentSession() {
    if (state.currentMode === 'review') return; // No guardamos los repasos
    const sessionData = {
        currentMode: state.currentMode,
        originalMode: state.originalMode,
        currentTopicName: state.currentTopicName,
        currentQuestions: state.currentQuestions,
        currentIndex: state.currentIndex,
        score: state.score,
        userAnswers: state.userAnswers,
        timeRemaining: state.timeRemaining,
        currentTestId: state.currentTestId
    };
    Storage.saveSuspendedSession(sessionData);
}

export function restoreSession(savedState) {
    if (!savedState || !savedState.currentQuestions) return;

    state.currentMode = savedState.currentMode || 'training';
    state.originalMode = savedState.originalMode || state.currentMode;
    state.currentTopicName = savedState.currentTopicName || 'Test Rescatado';
    state.currentQuestions = savedState.currentQuestions;
    state.currentIndex = savedState.currentIndex || 0;
    state.score = savedState.score || 0;
    state.userAnswers = savedState.userAnswers || {};
    state.currentTestId = savedState.currentTestId || null;

    // ── Restaurar cronómetro si era un examen ──
    if (state.currentMode === 'exam') {
        const savedTime = savedState.timeRemaining;
        // Si había tiempo guardado y es válido, lo retomamos; si no, recalculamos
        const seconds = (typeof savedTime === 'number' && savedTime > 0)
            ? savedTime
            : state.currentQuestions.length * 60;
        startTimer(seconds);
    } else {
        stopTimer();
    }

    // Sincronizar UI
    toggleEl('btn-clear-failures-header', state.currentMode === 'failures');
    showView('game');

    // Forzar el render para actualizar contadores y botones basados en la longitud real
    renderQuestion();
}

// ── Vista Completa (Scroll Continuo) ──────────────────────────────────────────

let _fullViewActive = false;

/**
 * Deja la vista de juego en modo "pregunta individual" (estado por defecto).
 * Se llama al arrancar cada test para no heredar una vista completa activa.
 */
function resetFullView() {
    _fullViewActive = false;
    const singleCard = document.querySelector('#view-game .question-card');
    const controls   = document.querySelector('#view-game .controls');
    const fullView   = document.getElementById('full-exam-view');
    const toggleBtn  = document.getElementById('btn-toggle-fullview');
    if (singleCard) singleCard.classList.remove('hidden');
    if (controls)   controls.classList.remove('hidden');
    if (fullView)   { fullView.classList.add('hidden'); fullView.innerHTML = ''; }
    if (toggleBtn)  toggleBtn.classList.remove('active-view-btn');
}

export function toggleFullView() {
    _fullViewActive = !_fullViewActive;

    const singleCard = document.querySelector('#view-game .question-card');
    const controls   = document.querySelector('#view-game .controls');
    const fullView   = document.getElementById('full-exam-view');
    const toggleBtn  = document.getElementById('btn-toggle-fullview');

    if (_fullViewActive) {
        // Ocultar vista individual
        if (singleCard) singleCard.classList.add('hidden');
        if (controls)   controls.classList.add('hidden');
        if (toggleBtn)  toggleBtn.classList.add('active-view-btn');
        renderFullView(fullView);
        fullView.classList.remove('hidden');
    } else {
        // Volver a vista individual
        fullView.classList.add('hidden');
        if (singleCard) singleCard.classList.remove('hidden');
        if (controls)   controls.classList.remove('hidden');
        if (toggleBtn)  toggleBtn.classList.remove('active-view-btn');
        // Sincronizar: re-renderizar la pregunta actual con las respuestas dadas en la vista completa
        renderQuestion();
    }
}

function renderFullView(container) {
    container.innerHTML = '';
    container.className = 'full-exam-view';

    state.currentQuestions.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'full-view-question-card';
        card.dataset.idx = idx;

        const header = document.createElement('div');
        header.className = 'full-view-q-header';
        header.innerHTML = `<span class="full-view-q-num">${idx + 1}</span><span class="tag" style="font-size:0.75rem;">${(q.tema || '').match(/Tema \d+/)?.[0] || 'General'}</span>`;
        card.appendChild(header);

        const qText = document.createElement('p');
        qText.className = 'full-view-q-text';
        qText.textContent = q.pregunta;
        card.appendChild(qText);

        const optsDiv = document.createElement('div');
        optsDiv.className = 'full-view-opts';

        // Mapa botón → letra, para colorear sin parsear el innerHTML
        const btnLetters = new Map();

        const chosen = state.userAnswers[idx];
        const mode = state.currentMode;

        ['a', 'b', 'c', 'd'].forEach(letter => {
            if (!q.opciones?.[letter]) return;
            const btn = document.createElement('button');
            btn.className = 'btn-option full-view-opt';
            btn.innerHTML = `<strong>${letter.toUpperCase()})</strong> ${q.opciones[letter]}`;

            if (mode === 'review') {
                // Revisión: todo bloqueado, mostrando correcta y elección previa
                btn.disabled = true;
                if (letter === q.correcta) btn.classList.add('correct');
                else if (letter === chosen) btn.classList.add('incorrect');
            } else if (mode === 'exam') {
                // Examen: solo resaltado de la selección, siempre re-clicable
                if (chosen === letter) btn.classList.add('exam-selected');
                btn.addEventListener('click', () => {
                    state.userAnswers[idx] = letter;
                    [...optsDiv.children].forEach(b => b.classList.remove('exam-selected'));
                    btn.classList.add('exam-selected');
                    saveCurrentSession();
                });
            } else {
                // Entrenamiento / fallos: una sola respuesta, con corrección inmediata
                if (chosen) {
                    btn.disabled = true;
                    if (letter === q.correcta) btn.classList.add('correct');
                    else if (letter === chosen) btn.classList.add('incorrect');
                } else {
                    btn.addEventListener('click', () => {
                        if (state.userAnswers[idx]) return; // ya respondida
                        state.userAnswers[idx] = letter;

                        const isCorrect = letter === q.correcta;
                        if (isCorrect) {
                            state.score++;
                            Storage.removeFailedId(q.id); // auto-perdón (igual que en vista individual)
                        } else {
                            Storage.addFailedId(q.id);
                        }
                        updateFailureBadge(Storage.getFailedIds().length);

                        // Bloquear y colorear todas las opciones de la pregunta
                        btnLetters.forEach((ltr, b) => {
                            b.disabled = true;
                            if (ltr === q.correcta) b.classList.add('correct');
                            else if (ltr === letter) b.classList.add('incorrect');
                        });

                        // Sincronizar el contador de aciertos del header
                        const scoreEl = document.getElementById('score-badge');
                        if (scoreEl) scoreEl.textContent = `Aciertos: ${state.score}`;

                        saveCurrentSession();
                    });
                }
            }

            optsDiv.appendChild(btn);
            btnLetters.set(btn, letter);
        });

        card.appendChild(optsDiv);
        container.appendChild(card);
    });

    // Botón Finalizar al final
    const finishBtn = document.createElement('button');
    finishBtn.className = 'btn-primary full-view-finish-btn';
    finishBtn.innerHTML = 'Finalizar Test 🏁';

    const handleFinish = () => {
        console.log('Finalizar button clicked in Full View');
        // Salir de la vista completa antes de calcular resultados
        _fullViewActive = false;
        const singleCard = document.querySelector('#view-game .question-card');
        const controls   = document.querySelector('#view-game .controls');
        const fullView   = document.getElementById('full-exam-view');
        const toggleBtn  = document.getElementById('btn-toggle-fullview');
        if (singleCard) singleCard.classList.remove('hidden');
        if (controls)   controls.classList.remove('hidden');
        if (toggleBtn)  toggleBtn.classList.remove('active-view-btn');
        fullView.classList.add('hidden');
        
        try {
            finishGame();
        } catch (err) {
            console.error('Error finishing game:', err);
            alert('Hubo un error al finalizar el test. Por favor, intenta de nuevo o contacta con soporte.');
        }
    };

    finishBtn.addEventListener('click', handleFinish);
    // Add touch support just in case click is being blocked/delayed on mobile
    finishBtn.addEventListener('touchend', (e) => {
        if (_fullViewActive) {
            e.preventDefault();
            handleFinish();
        }
    }, { passive: false });

    container.appendChild(finishBtn);
}
