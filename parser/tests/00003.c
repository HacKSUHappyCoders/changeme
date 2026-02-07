int main() {
    int x = 10;

    while (x > 0 || x == 10) {
        x -= 3;
    }

    if (x > 0) {
        x = 100;
    } else {
        x = 0;
    }

    return x;
}
