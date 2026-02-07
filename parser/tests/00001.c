
int main() {

    int sum = 0;
    for (int i = 0; i<5; i++){
        // read sum, i
        sum += i;
    }

    if (sum < 10){
        sum *= 10;
    } else {
        sum += 1;
    }


    return 0;
}
