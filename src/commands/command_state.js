

class CommandState {
    // Constants for background execute to return
    static get finished() {
        return 0;
    }

    static get keepGoing() {
        return 1;
    }

    static get keepGoingBackOff() {
        return 2;
    }
}

module.exports = CommandState;
