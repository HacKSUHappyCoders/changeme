def add(a, b):
    result = a + b
    return result


def main():
    x = 10
    y = 20
    total = add(x, y)

    if total > 25:
        total *= 2
    elif total > 15:
        total += 5
    else:
        total = 0

    for i in range(5):
        x += i

    count = 0
    while count < 3:
        count += 1

    return total


main()
