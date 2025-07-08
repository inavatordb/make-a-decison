// gameData.js

const questions = [
    {
        question: "A poll of 100 women asked: Which countries have the best looking men? (By % of votes)",
        answers: [
            { text: "Italy", rank: 1, stat: "25%" },
            { text: "France", rank: 2, stat: "18%" },
            { text: "Spain", rank: 3, stat: "15%" },
            { text: "US", rank: 4, stat: "12%" },
            { text: "Mexico", rank: 5, stat: "10%" },
            { text: "England", rank: 6, stat: "8%" },
        ]
    },
    {
        question: "According to their average lifespan, rank these animals from longest to shortest lived.",
        answers: [
            { text: "Greenland Shark", rank: 1, stat: "400 years" },
            { text: "Elephant", rank: 2, stat: "70 years" },
            { text: "Falcon", rank: 3, stat: "30 years" },
            { text: "Cat", rank: 4, stat: "15 years" },
            { text: "Dog", rank: 5, stat: "12 years" },
            { text: "Pig", rank: 6, stat: "10 years" },
        ]
    }
];

// Function to get a random question
function getQuestion() {
    const randomIndex = Math.floor(Math.random() * questions.length);
    return questions[randomIndex];
}

module.exports = { getQuestion };