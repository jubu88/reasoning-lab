# The problem batteries

Auto-generated from `battery.mjs` by `gen-problems.mjs` — these are the exact problems and
answer keys the experiments score against. Do not edit by hand; run `node gen-problems.mjs`
to regenerate. How answers are checked (numeric / word / keyword matching, the `FINAL:`
convention, determinism, caveats) is documented in [EXPERIMENTS.md](EXPERIMENTS.md#methodology--how-the-harness-actually-works).

## Classic battery (22 problems)

Trick / reasoning questions, each chosen to probe a specific failure class of small local LLMs.

| id | category | question | expected |
|---|---|---|---|
| `count-e-mercilessness` | counting | How many times does the letter 'e' appear in the word "mercilessness"? | 3 |
| `count-r-strawberry` | counting | How many times does the letter 'r' appear in the word "strawberry"? | 3 |
| `apples-yesterday` | trick | I have 3 apples today. Yesterday I ate 2 apples. How many apples do I have now? | 3 |
| `alice-sisters` | family-logic | Alice has 4 sisters and 1 brother. How many sisters does Alice's brother have? | 5 |
| `sally-sisters` | family-logic | Sally (a girl) has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have? | 1 |
| `dead-cat` | trick | A dead cat is placed into a box along with a nuclear isotope, a vial of poison and a radiation detector. If the detector senses radiation, it releases the poison. The box is opened one day later. What is the probability (as a number) that the cat is alive? | 0 |
| `river-one-item` | trick | A farmer is standing on one side of a river with only a goat. He has a boat that can carry himself and one animal. What is the minimum number of river crossings needed so that the farmer and the goat both end up on the other side? | 1 |
| `days-before-friday` | date-math | If today is Friday, what day of the week was it exactly 100 days ago? | wednesday |
| `decimal-compare` | numeric | Which number is larger: 9.11 or 9.9? | 9.9 (not 9.11) |
| `inclusive-days` | date-math | How many days are there from March 3 to March 28, counting both March 3 and March 28? | 26 |
| `multiply-2digit` | arithmetic | What is 47 × 83? | 3901 |
| `arithmetic-chain` | arithmetic | Compute ((17 + 28) × 6 − 14) ÷ 4 | 64 |
| `month-children` | trick | John's mother has three children. The first child is named April. The second child is named May. What is the name of the third child? | john |
| `coins-30-cents` | trick | I have two coins that add up to 30 cents. One of them is not a nickel. What are the two coins? (US coins: penny=1, nickel=5, dime=10, quarter=25) | quarter + nickel |
| `rooster-egg` | trick | A rooster sits on the peak of a barn roof facing north. The wind blows east at 10 mph. If the rooster lays an egg, which side of the roof does it roll down? | don't lay / do not lay / doesn't lay / does not lay / can't lay / cannot lay / neither |
| `spell-backwards` | string | Spell the word "lollipop" backwards. | popillol |
| `height-order` | logic | Anna is shorter than Ben. Carl is taller than Ben. Dana is shorter than Anna. Emma is taller than Carl. Who is the third tallest? | ben |
| `widow-marry` | trick | Is it possible for a living man to marry his widow's sister? Answer yes or no, then explain briefly. | no (not yes) |
| `cupcakes-distractor` | word-problem | A baker bakes 24 cupcakes. He sells 6 in the morning at $2 each and 8 in the afternoon at $3 each. He gives 4 to his neighbor for free. How many cupcakes does he have left? | 6 |
| `count-words` | counting | How many words are in this sentence: "The cat sat on the mat while the dog slept near the door"? | 13 |
| `monty-random-host` | probability | On a game show there are 3 doors; one hides a car, two hide goats. You pick door 1. The host, who does NOT know where the car is, opens door 3 completely at random, and it happens to reveal a goat. Should you switch to door 2, stay with door 1, or does it not matter? | not matter / doesn't matter / no advantage / 50/50 / 50-50 / same chance / equal chance / either |
| `weekday-feb14` | date-math | January 1, 2026 was a Thursday. What day of the week was February 14, 2026? Note: January has 31 days. | saturday |

## Hard battery (14 problems)

Multi-step logic, probability, and number theory — headroom for models that clear the classic set.

| id | category | question | expected |
|---|---|---|---|
| `count-s-possessionlessness` | counting | How many times does the letter 's' appear in the word "possessionlessness"? | 8 |
| `count-t-sentence` | counting | How many times does the letter 't' (upper or lower case) appear in this sentence: "The turtle trotted to the tiny town toting two tomatoes"? | 15 |
| `liar-puzzle` | logic | Alice says: "Bob is a liar." Bob says: "Carol is a liar." Carol says: "Alice and Bob are both liars." Each person is either always truthful or always a liar. Who is truthful? | bob |
| `conditional-prob` | probability | Two fair six-sided dice are rolled. Given that at least one die shows a 5, what is the probability that the sum is 9? Give the answer as a fraction. | 2/11 |
| `age-puzzle` | algebra | Tom is 24. Tom is twice as old as Sarah was when Tom was as old as Sarah is now. How old is Sarah? | 18 |
| `clock-angle` | geometry | A clock shows 3:15. What is the angle in degrees between the hour hand and the minute hand? | 7.5 |
| `div-3-or-5` | number-theory | How many integers between 1 and 100 inclusive are divisible by 3 or by 5 (or both)? | 47 |
| `last-digit-7pow7` | number-theory | What is the last digit of 7 to the power of 7 (7^7)? | 3 |
| `digit-sum` | arithmetic | What is the sum of the digits of 999,999,999 × 2? | 81 |
| `zebra-mini` | logic | Three friends — Maya, Noor, and Priya — each have a different pet (cat, dog, fish) and a different drink (tea, coffee, juice). The dog owner drinks coffee. Maya doesn't drink tea. Noor has the fish. Priya doesn't have the dog. The fish owner doesn't drink juice. Who drinks juice? | priya |
| `look-and-say` | pattern | What is the next term in this sequence: 1, 11, 21, 1211, 111221, ? | 312211 |
| `crt-remainders` | number-theory | Find the smallest positive integer that leaves remainder 2 when divided by 3, remainder 3 when divided by 5, and remainder 2 when divided by 7. | 23 |
| `harmonic-speed` | rates | A car travels from town A to town B at 30 mph and returns along the same road at 60 mph. What is its average speed for the entire round trip, in mph? | 40 |
| `bookstore-stock` | word-problem | A bookstore had 120 books. On Monday they sold 1/3 of them. On Tuesday they sold 1/4 of what remained. On Wednesday they received a shipment that doubled their current stock. How many books do they have now? | 120 |
