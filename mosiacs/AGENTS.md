# Copilot Agent Instruction — What a “Building” Represents in the Visual Debugger

You are implementing a 3D visual debugger where a program execution trace is rendered as a spiral city.
**A building must never represent a line of code or an AST node.**
A building represents a *persistent runtime concept* — something that continues to exist across multiple execution events.

The visualization is driven by the execution trace (CALL, DECL, ASSIGN, LOOP, CONDITION, BRANCH, RETURN).
The user navigates forward along a spiral path that represents **time**. Each trace event advances time.

Your task: construct buildings based on runtime responsibility, not syntax.

---

## Core Rule

Create buildings only for entities that have lifetime:

1. Functions
2. Variables
3. Control Flow Structures (loops + branches)
4. Memory

Instructions are moments.
Buildings are things that persist across moments.

---

## Building Types

---

### 1. Function Buildings (Districts)

**Represents:** a stack frame / function invocation

Create a large landmark structure when a CALL event occurs:

```
CALL main
```

Behavior:

* Enter the function building when a CALL happens
* Exit when RETURN occurs
* Stack depth determines vertical placement (higher depth = higher floor)
* Nested calls are physically above the caller

Data displayed inside:

* Function name
* Current stack depth
* Active local variables
* Return value (when available)

Implementation mapping:

* CALL → create or activate function district
* RETURN → close the district and emit a return object leaving the building

The player should experience the call stack as moving between floors.

---

### 2. Variable Buildings (Houses)

**Represents:** a variable with storage location and lifetime

Create one persistent building per unique variable identity:
Key = (function_scope + variable_name + memory_address)

Example:

```
DECL sum address 000000660F5FF91C
```

The building must persist for the entire lifetime of the variable.

Inside the building store:

* Variable name
* Address (street address metaphor)
* Current value
* Value history
* Last writer (line/event)

Behavior:

* DECL → construct the house and turn lights on
* ASSIGN → deliver a value to the house and update visible display
* Variable value should be visibly displayed on the building exterior
* When scope ends → lights turn off

Important:
If the same address appears again, it is the same physical memory location and must reuse the same building.

---

### 3. Loop Buildings (Factories)

**Represents:** repetition machinery (NOT a place in code)

Create a factory when a LOOP event is encountered:

```
LOOP subtype=for condition="i<5"
```

The building represents a repeating process.

Behavior:

* Each LOOP event with condition_result = 1 is one machine cycle
* Increment an iteration counter
* Trigger the events occurring inside the loop
* When condition_result = 0 → the factory stops operating

Data to store:

* Loop condition
* Iteration count
* Exit reason (condition became false)

The user must be able to visually perceive repetition occurring.

---

### 4. Branch Buildings (Intersections)

**Represents:** a decision point

Create a road fork when a CONDITION event occurs:

```
CONDITION sum < 10 → false
BRANCH else
```

Behavior:

* Evaluate the condition
* Activate only the chosen path
* Non-taken paths must visibly deactivate

Data to store:

* Condition expression
* Boolean result
* Selected branch

The visualization should communicate that execution follows a path, not a jump.

---

### 5. Memory Layer (Underground System)

**Represents:** raw memory

All variable buildings must connect to a memory node using their address:

```
address = 000000660F5FF91C
```

Rules:

* Identical addresses share the same memory node
* Visualize shared memory connections
* Support pointer visualization later

This allows detection of aliasing and memory errors.

---

## Event → World Mapping

| Trace Event  | World Action            |
| ------------ | ----------------------- |
| CALL         | Enter function district |
| DECL         | Create variable house   |
| ASSIGN       | Update house value      |
| LOOP (true)  | Run factory cycle       |
| LOOP (false) | Stop factory            |
| CONDITION    | Evaluate intersection   |
| BRANCH       | Choose road             |
| RETURN       | Exit function           |

---


## Non-Goals

Do NOT:

* Render AST nodes as buildings
* Place one building per line number
* Treat statements as objects

This system is a runtime world simulation, not a code viewer.

---

Implement the world as a simulation of program execution state over time.


## PHASE TWO

This is the next phase is the development of the application. Now that we have the buildings defined and looking good in the spiral, we now need to define when a building is created, in addition how a buildings color is defined and also how code inside of building blocks are defined and viewed. 

Firstly, here are the rules for when buildings are created. So we will have 5 different types of builidns, for this new phase we are adding in while loops as a new bulidng. 

Functions: new building on function invocation. Everytime the function is called a new building should be created
Variables: On declaration make a new building, and also make sure that the variables values are stored throughout the course of program and you can see the flow of its values overtime.
For loops: Each time the loop is at its first iteration make it a new building. 
If statement: for each if statement make a building and make a chain of buildings for if, if else and else
While: same as for loops

Now to define the colors, we will do a combo of hash and specific coloring. You should create a hash based on the name or other indetifying data that each piece has and then we will use a color schema to declare each one. So the color schema follows the RGB aproach with the following idea

# IDEA
X X X
X X 255
X 255 255
255 255 255
X 255 X
255 255 X
255 X 255

The 255 values are solid inplace, but the X values can be changed and are determing by the unique hash that was created above. This will make sure that if a function building is shown multiple times that it is the same color, like hello() should be the same color throughout and end() should be a different color then hello().

## NEW BIG FEATURE
Now we want to build a spiral inside of spiral idea. So for example, we have function buildings, and inside of functions there is code. So lets make it so when we click on a function, if statement, for loop and while loop, a new spiral comes out of them that represents the code inside of them. This code inside each would not be displayed in the main spiral, but instead in this mini subversion spiral. Also can you make it so all the spirals are visibly created as the program is run. and also keep all the spiral visible. In addition, each spirals path color should be different too. But essentially I want spirals building off of spirals to make a really cool mosiac.