/**
 * About Page Component
 * Static content page describing the Acting Intern philosophy and creator
 */

const About = {
    render() {
        const content = document.getElementById('main-content');

        content.innerHTML = `
            <div class="about-page">

                <div class="about-hero">
                    <div class="about-hero-title">
                        <span class="logo-ai">A</span>cting <span class="logo-ai">I</span>ntern
                    </div>
                    <p class="about-hero-tagline">A PHI-free playground for exploring how AI can support clinical reasoning and medical decision-making.</p>
                </div>

                <div class="about-section">
                    <h2>Why "Acting Intern"?</h2>
                    <p>
                        In the final year of medical school, students complete a capstone rotation called the Acting Internship. By this point, they have accumulated an enormous body of knowledge — sometimes a PhD's worth of scientific depth — and have become remarkably effective at getting things done in the hospital. They build problem representations, construct differential diagnoses, develop frameworks and approaches, and maintain meticulous problem lists.
                    </p>
                    <p>
                        What makes acting interns unique is their relationship to supervision. An attending might give a general instruction — "let's replete their potassium" — and the acting intern does the diligent work: researching the right formulation, checking renal function, reviewing the rate of correction, and entering a specific order for a senior resident or attending to cosign. They don't make the final call, but they do the thinking that makes the final call possible.
                    </p>
                    <p>
                        This is exactly the role we envision for AI in clinical care. An AI acting intern brings the same attributes: deep knowledge, diligent research, structured clinical reasoning, and a clear understanding that the physician drives the decisions. By naming this project Acting Intern, we invoke that relationship — capable, supportive, never overstepping.
                    </p>
                </div>

                <div class="about-section">
                    <h2>Philosophy</h2>
                    <p>
                        Acting Intern is built on a simple conviction: AI should support the physician's reasoning process, not supplant it.
                    </p>
                    <p>
                        The doctor drives decision-making. The AI supports by organizing information, surfacing relevant data at the right moment, flagging safety concerns, and tracking what has been addressed versus what remains open. It mirrors back the clinician's own thinking in a structured way — not to lead, but to help them see the full picture.
                    </p>
                    <p>
                        This platform is a PHI-free environment where clinicians, educators, and developers can explore how agentic AI will reshape medical workflows. Every patient is synthetic. Every interaction is a learning opportunity. The goal is to understand, before these tools reach the bedside, how they should behave when they get there.
                    </p>
                </div>

                <div class="about-section">
                    <h2>About the Creator</h2>
                    <p>
                        I studied cognitive science as an undergraduate, with a focus on human-computer interaction and a passion for architectures of intelligence — how minds organize, retrieve, and apply knowledge in complex environments.
                    </p>
                    <p>
                        That passion found a natural home in medical education, where the same principles of knowledge building and reasoning exist, all deeply focused on the patient in front of us. How can we reason the best for our patients? How should we structure our thinking, our notes, our signout? How can our cognitive frameworks and information management help us be fully present at the bedside?
                    </p>
                    <p>
                        Over the past 15 years, I have had the privilege of supervising thousands of Stanford residents, medical students, and advanced practice providers. That experience has shaped a deep belief: the best clinical tools don't replace thinking — they create the conditions for better thinking.
                    </p>
                    <p>
                        Acting Intern is an expression of that belief. It's an exploration of how AI, designed with the right relationship to the clinician, can further support our reasoning process to create the best care for our patients.
                    </p>
                </div>

                <div class="about-footer">
                    <p>Built with care in the spirit of better clinical reasoning.</p>
                </div>

            </div>
        `;
    }
};

window.About = About;
